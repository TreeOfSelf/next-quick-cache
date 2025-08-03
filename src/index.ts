const cache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const backgroundRevalidations = new Set<string>();
const functionCache = new Map<string, Function>();

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
    
    // THIS IS THE CRITICAL FIX that makes it behave like unstable_cache
    // Create a unique key for the function's configuration.
    const functionConfigKey = `${fetchData.toString()}:${JSON.stringify(keyParts)}`;
    
    // If we have already created a cached function for this exact configuration,
    // return that same function instance immediately.
    if (functionCache.has(functionConfigKey)) {
        return functionCache.get(functionConfigKey) as (...args: TArgs) => Promise<TReturn>;
    }
     
    // If not, create a new cached function.
    const cachedFunction = async (...args: TArgs): Promise<TReturn> => {
        const argsKey = JSON.stringify(args);
        // The final cache key is a combination of the function's unique keyParts and the specific arguments for this call.
        const cacheKey = `${JSON.stringify(keyParts)}:${argsKey}`;
        
        const cachedEntry = cache.get(cacheKey) as CacheEntry<TReturn> | undefined;
        
        if (cachedEntry) {
            if (revalidate !== false && Date.now() > cachedEntry.expiry) {
                revalidateInBackground(fetchData, args, cacheKey, revalidate);
            }
            return cachedEntry.data;
        }
        
        if (inFlightRequests.has(cacheKey)) {
            return inFlightRequests.get(cacheKey) as Promise<TReturn>;
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
    
    // Store the newly created function in the function cache for future calls.
    functionCache.set(functionConfigKey, cachedFunction as Function);
    
    return cachedFunction;
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
            // In a real library, you might want a more robust logging or error handling strategy.
            console.warn('Background revalidation failed:', error);
        } finally {
            backgroundRevalidations.delete(cacheKey);
        }
    })();
};
