import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'crypto'
import superjson from 'superjson'

const cache = new Map<string, CacheEntry<unknown>>()
const inFlightRequests = new Map<string, Promise<unknown>>()
const backgroundRevalidations = new Set<string>()
const pendingWrites = new Map<string, { promise: Promise<void>, entry: CacheEntry<unknown> }>()

const tagToCacheKeys = new Map<string, Set<string>>()

const CACHE_DIR = path.join(os.tmpdir(), 'quick-cache')

interface CacheOptions<TArgs extends readonly unknown[], TReturn> {
    tags?: string[]
    revalidate?: number | false
    startingValue?: (...args: TArgs) => TReturn
    persistToDisk?: boolean
    serveStale?: boolean
}

interface CacheEntry<T> {
    data: T
    expiry: number
    revalidate: number | false
    tags?: string[]
}

let cacheDirectoryInitialized = false
const initializeCacheDirectory = async () => {
    if (!cacheDirectoryInitialized) {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true })
            cacheDirectoryInitialized = true
        } catch (error) {
            console.warn('Could not create cache directory:', error)
        }
    }
}

const getCacheFilePath = (cacheKey: string): string => {
    const hash = createHash('sha256').update(cacheKey).digest('hex')
    return path.join(CACHE_DIR, `${hash}.json`)
}

const loadFromDisk = async (cacheKey: string): Promise<{ entry: CacheEntry<unknown> | null, isExpired: boolean }> => {
    try {
        await initializeCacheDirectory()
        const filePath = getCacheFilePath(cacheKey)
        const data = await fs.readFile(filePath, 'utf8')
        const entry = superjson.parse(data) as CacheEntry<unknown>
        const isExpired = entry.expiry !== Infinity && Date.now() > entry.expiry
        return { entry, isExpired }
    } catch {
        return { entry: null, isExpired: false }
    }
}

const saveToDisk = async (cacheKey: string, entry: CacheEntry<unknown>): Promise<void> => {
    const filePath = getCacheFilePath(cacheKey)
    
    const existing = pendingWrites.get(filePath)
    if (existing) {
        existing.entry = entry
        return existing.promise
    }

    const writeOperation = (async () => {
        try {
            await initializeCacheDirectory()
            const latestEntry = pendingWrites.get(filePath)?.entry || entry
            await fs.writeFile(filePath, superjson.stringify(latestEntry))
        } catch (error) {
            console.warn('Failed to save cache to disk:', error)
            throw error
        } finally {
            pendingWrites.delete(filePath)
        }
    })()

    pendingWrites.set(filePath, { promise: writeOperation, entry })
    return writeOperation
}

export const revalidateTag = async (tag: string): Promise<void> => {
    const cacheKeys = tagToCacheKeys.get(tag)
    if (!cacheKeys) {
        return
    }

    const promises: Promise<void>[] = []
    for (const cacheKey of cacheKeys) {
        promises.push((async () => {
            let entry = cache.get(cacheKey) as CacheEntry<unknown> | undefined

            if (!entry) {
                const diskResult = await loadFromDisk(cacheKey)
                if (diskResult.entry) {
                    entry = diskResult.entry
                }
            }

            if (entry) {
                entry.expiry = 0
                await saveToDisk(cacheKey, entry)
            }
        })())
    }
    await Promise.all(promises)
}

export default function quick_cache<TArgs extends readonly unknown[], TReturn>(
    fetchData: (...args: TArgs) => Promise<TReturn>,
    keyParts?: readonly string[],
    options: CacheOptions<TArgs, TReturn> = {}
): (...args: TArgs) => Promise<TReturn> {
    const { revalidate = false, startingValue, persistToDisk = true, tags = [], serveStale = true } = options

    return async (...args: TArgs): Promise<TReturn> => {
        const argsKey = JSON.stringify(args)
        const keyPartsKey = keyParts ? JSON.stringify(keyParts) : ''
        const functionKey = fetchData.toString()
        const cwdKey = process.cwd()
        const cacheKey = `${cwdKey}:${functionKey}:${keyPartsKey}:${argsKey}`

        let cachedEntry = cache.get(cacheKey) as CacheEntry<TReturn> | undefined

        if (!cachedEntry && persistToDisk) {
            const diskResult = await loadFromDisk(cacheKey)
            if (diskResult.entry) {
                cachedEntry = diskResult.entry as CacheEntry<TReturn>
                if (!diskResult.isExpired) {
                    cache.set(cacheKey, cachedEntry)
                }
                if (cachedEntry.tags) {
                    for (const tag of cachedEntry.tags) {
                        if (!tagToCacheKeys.has(tag)) {
                            tagToCacheKeys.set(tag, new Set())
                        }
                        tagToCacheKeys.get(tag)!.add(cacheKey)
                    }
                }
            }
        }

        if (cachedEntry) {
            const needsRevalidation = revalidate !== false && Date.now() > cachedEntry.expiry
            if (needsRevalidation) {
                if (serveStale) {
                    revalidateInBackground(fetchData, args, cacheKey, revalidate, persistToDisk, tags)
                    return cachedEntry.data
                } else {
                    cache.delete(cacheKey)
                }
            } else {
                return cachedEntry.data
            }
        }

        if (inFlightRequests.has(cacheKey)) {
            if (startingValue) {
                return startingValue(...args)
            } else {
                return inFlightRequests.get(cacheKey) as Promise<TReturn>
            }
        }

        const requestPromise = (async () => {
            try {
                const freshData = await fetchData(...args)
                const expiry = revalidate === false ? Infinity : Date.now() + revalidate * 1000
                const entry: CacheEntry<TReturn> = {
                    data: freshData,
                    expiry,
                    revalidate,
                    tags
                }
                cache.set(cacheKey, entry)
                if (tags.length > 0) {
                    for (const tag of tags) {
                        if (!tagToCacheKeys.has(tag)) {
                            tagToCacheKeys.set(tag, new Set())
                        }
                        tagToCacheKeys.get(tag)!.add(cacheKey)
                    }
                }
                if (persistToDisk) {
                    saveToDisk(cacheKey, entry).catch(error => {
                        console.warn('Failed to save cache to disk:', error)
                    })
                }
                return freshData
            } finally {
                inFlightRequests.delete(cacheKey)
            }
        })()

        inFlightRequests.set(cacheKey, requestPromise)

        if (startingValue) {
            return startingValue(...args)
        }

        return requestPromise
    }
}

const revalidateInBackground = <TArgs extends readonly unknown[], TReturn>(
    fetchData: (...args: TArgs) => Promise<TReturn>,
    args: TArgs,
    cacheKey: string,
    revalidate: number | false,
    persistToDisk: boolean = true,
    tags: string[] = []
) => {
    if (backgroundRevalidations.has(cacheKey)) {
        return
    }
    backgroundRevalidations.add(cacheKey)
    ;(async () => {
        try {
            const freshData = await fetchData(...args)
            const expiry = revalidate === false ? Infinity : Date.now() + revalidate * 1000
            const entry: CacheEntry<TReturn> = {
                data: freshData,
                expiry,
                revalidate,
                tags
            }
            cache.set(cacheKey, entry)
            if (tags.length > 0) {
                for (const tag of tags) {
                    if (!tagToCacheKeys.has(tag)) {
                        tagToCacheKeys.set(tag, new Set())
                    }
                    tagToCacheKeys.get(tag)!.add(cacheKey)
                }
            }
            if (persistToDisk) {
                saveToDisk(cacheKey, entry).catch(error => {
                    console.warn('Background revalidation disk save failed:', error)
                })
            }
        } catch (error) {
            console.warn('Background revalidation failed:', error)
        } finally {
            backgroundRevalidations.delete(cacheKey)
        }
    })()
}