import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const cache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const backgroundRevalidations = new Set<string>();

const CACHE_DIR = path.join(os.tmpdir(), 'quick-cache');

interface CacheOptions<TArgs extends readonly unknown[], TReturn> {
    tags?: string[];
    revalidate?: number | false;
    startingValue?: (...args: TArgs) => TReturn;
    persistToDisk?: boolean;
}

interface CacheEntry<T> {
    data: T;
    expiry: number;
    revalidate: number | false;
}

let cacheDirectoryInitialized = false;
const initializeCacheDirectory = async () => {
    if (!cacheDirectoryInitialized) {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
            cacheDirectoryInitialized = true;
        } catch (error) {
            console.warn('Could not create cache directory:', error);
        }
    }
};

const getCacheFilePath = (cacheKey: string): string => {
    const safeKey = Buffer.from(cacheKey).toString('base64').replace(/[/+=]/g, '_');
    return path.join(CACHE_DIR, `${safeKey}.json`);
};

const loadFromDisk = async (cacheKey: string): Promise<CacheEntry<unknown> | null> => {
    try {
        await initializeCacheDirectory();
        const filePath = getCacheFilePath(cacheKey);
        const data = await fs.readFile(filePath, 'utf8');
        const entry = JSON.parse(data) as CacheEntry<unknown>;
        
        if (entry.expiry !== Infinity && Date.now() > entry.expiry) {
            fs.unlink(filePath).catch(() => {});
            return null;
        }
        
        return entry;
    } catch {
        return null;
    }
};

const saveToDisk = async (cacheKey: string, entry: CacheEntry<unknown>): Promise<void> => {
    try {
        await initializeCacheDirectory();
        const filePath = getCacheFilePath(cacheKey);
        await fs.writeFile(filePath, JSON.stringify(entry));
    } catch (error) {
        console.warn('Failed to save cache to disk:', error);
    }
};

export default function quick_cache<TArgs extends readonly unknown[], TReturn>(
    fetchData: (...args: TArgs) => Promise<TReturn>,
    keyParts?: readonly string[],
    options: CacheOptions<TArgs, TReturn> = {}
): (...args: TArgs) => Promise<TReturn> {
    
    const { revalidate = false, startingValue, persistToDisk = true } = options;
    
    return async (...args: TArgs): Promise<TReturn> => {
        const argsKey = JSON.stringify(args);
        const keyPartsKey = keyParts ? JSON.stringify(keyParts) : '';
        const functionKey = fetchData.toString();
        const cacheKey = `${functionKey}:${keyPartsKey}:${argsKey}`;
        
        let cachedEntry = cache.get(cacheKey) as CacheEntry<TReturn> | undefined;
        
        if (!cachedEntry && persistToDisk) {
            const diskEntry = await loadFromDisk(cacheKey);
            if (diskEntry) {
                cachedEntry = diskEntry as CacheEntry<TReturn>;
                cache.set(cacheKey, cachedEntry);
            }
        }
        
        if (cachedEntry) {
            if (revalidate !== false && Date.now() > cachedEntry.expiry) {
                revalidateInBackground(fetchData, args, cacheKey, revalidate, persistToDisk);
            }
            return cachedEntry.data;
        }
        
        if (inFlightRequests.has(cacheKey) && !startingValue) {
            return inFlightRequests.get(cacheKey) as Promise<TReturn>;
        }
        
        if (inFlightRequests.has(cacheKey) && startingValue) {
            return startingValue(...args);
        }
        
        const requestPromise = (async () => {
            try {
                const freshData = await fetchData(...args);
                const expiry = revalidate === false ? Infinity : Date.now() + revalidate * 1000;
                const entry: CacheEntry<TReturn> = {
                    data: freshData,
                    expiry,
                    revalidate
                };
                
                cache.set(cacheKey, entry);
                
                if (persistToDisk) {
                    saveToDisk(cacheKey, entry);
                }
                
                return freshData;
            } finally {
                inFlightRequests.delete(cacheKey);
            }
        })();
        
        inFlightRequests.set(cacheKey, requestPromise);
        
        if (startingValue) {
            return startingValue(...args);
        }

        return requestPromise;
    };
}

const revalidateInBackground = <TArgs extends readonly unknown[], TReturn>(
    fetchData: (...args: TArgs) => Promise<TReturn>,
    args: TArgs,
    cacheKey: string,
    revalidate: number | false,
    persistToDisk: boolean = true
) => {
    if (backgroundRevalidations.has(cacheKey)) {
        return;
    }
    
    backgroundRevalidations.add(cacheKey);
    
    (async () => {
        try {
            const freshData = await fetchData(...args);
            const expiry = revalidate === false ? Infinity : Date.now() + revalidate * 1000;
            const entry: CacheEntry<TReturn> = {
                data: freshData,
                expiry,
                revalidate
            };
            
            cache.set(cacheKey, entry);
            
            if (persistToDisk) {
                saveToDisk(cacheKey, entry);
            }
        } catch (error) {
            console.warn('Background revalidation failed:', error);
        } finally {
            backgroundRevalidations.delete(cacheKey);
        }
    })();
};

export const clearCache = async (): Promise<void> => {
    cache.clear();
    try {
        await initializeCacheDirectory();
        const files = await fs.readdir(CACHE_DIR);
        await Promise.all(
            files
                .filter(file => file.endsWith('.json'))
                .map(file => fs.unlink(path.join(CACHE_DIR, file)))
        );
    } catch (error) {
        console.warn('Failed to clear disk cache:', error);
    }
};

export const getCacheStats = async (): Promise<{
    memoryEntries: number;
    diskEntries: number;
    diskSizeBytes?: number;
}> => {
    const memoryEntries = cache.size;
    
    try {
        await initializeCacheDirectory();
        const files = await fs.readdir(CACHE_DIR);
        const cacheFiles = files.filter(file => file.endsWith('.json'));
        
        let totalSize = 0;
        for (const file of cacheFiles) {
            try {
                const stats = await fs.stat(path.join(CACHE_DIR, file));
                totalSize += stats.size;
            } catch {}
        }
        
        return {
            memoryEntries,
            diskEntries: cacheFiles.length,
            diskSizeBytes: totalSize
        };
    } catch {
        return { memoryEntries, diskEntries: 0 };
    }
};