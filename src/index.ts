const cache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const backgroundRevalidations = new Set<string>();

interface CacheOptions<TArgs extends readonly unknown[], TReturn> {
    tags?: string[];
    revalidate?: number | false;
    startingValue?: (...args: TArgs) => TReturn;
}

interface CacheEntry<T> {
    data: T;
    expiry: number;
    revalidate: number | false;
}

export default function quick_cache<TArgs extends readonly unknown[], TReturn>(
    fetchData: (...args: TArgs) => Promise<TReturn>,
    keyParts?: readonly string[],
    options: CacheOptions<TArgs, TReturn> = {}
): (...args: TArgs) => Promise<TReturn> {
    
    const { revalidate = false, startingValue } = options;
    
    return async (...args: TArgs): Promise<TReturn> => {
        const argsKey = JSON.stringify(args);
        const keyPartsKey = keyParts ? JSON.stringify(keyParts) : '';
        const functionKey = fetchData.toString();
        const cacheKey = `${functionKey}:${keyPartsKey}:${argsKey}`;
        
        const cachedEntry = cache.get(cacheKey) as CacheEntry<TReturn> | undefined;
        
        if (cachedEntry) {
            if (revalidate !== false && Date.now() > cachedEntry.expiry) {
                revalidateInBackground(fetchData, args, cacheKey, revalidate);
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
                cache.set(cacheKey, {
                    data: freshData,
                    expiry,
                    revalidate
                });
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
    revalidate: number | false
) => {
    if (backgroundRevalidations.has(cacheKey)) {
        return;
    }
    
    backgroundRevalidations.add(cacheKey);
    
    (async () => {
        try {
            const freshData = await fetchData(...args);
            const expiry = revalidate === false ? Infinity : Date.now() + revalidate * 1000;
            cache.set(cacheKey, {
                data: freshData,
                expiry,
                revalidate
            });
        } catch (error) {
            console.warn('Background revalidation failed:', error);
        } finally {
            backgroundRevalidations.delete(cacheKey);
        }
    })();
};