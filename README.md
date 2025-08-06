# next-quick-cache

A lightweight TypeScript cache library with stale-while-revalidate support. Drop-in replacement for Next.js `unstable_cache` that works anywhere. 

The motivation for this was that I noticed unstable_cache has issues where if a process to revalidate is extremely heavy, it would run multiple processes if multiple people needed revalidations at once. It also would wait instead of serving stale data, which may end up having the user wait a long time. This solves that. 

## Features

- **Stale-while-revalidate** - Serves cached data instantly while fetching fresh data in background
- **Request deduplication** - Prevents multiple identical requests from running simultaneously  
- **TypeScript support** - Full type safety with generics
- **Simple API** - Same interface as Next.js `unstable_cache`
- **Universal** - Works in any JavaScript environment, not just Next.js
- **Disk persistence** - Optionally persist cache to disk for cross-process sharing

## Installation

```bash
npm install next-quick-cache
```

## Usage

### Basic Example

```typescript
import quick_cache from 'next-quick-cache';

// Create a cached function
const getCachedUser = quick_cache(
  async (id: string) => {
    // This expensive operation will be cached
    return await fetchUserFromDatabase(id);
  },
  ['user'], // Cache key parts
  {
    revalidate: 60, // Revalidate after 60 seconds
  }
);

// Use it like any async function
const user = await getCachedUser('123');
```

### Advanced Example

```typescript
import quick_cache from 'next-quick-cache';

// Cache with custom key parts
const getCachedData = quick_cache(
  async (userId: string, includeProfile: boolean) => {
    return await fetchComplexData(userId, includeProfile);
  },
  ['complex-data'], // Additional cache key identification
  {
    tags: ['users', 'profiles'], // Tags for cache invalidation (future feature)
    revalidate: 300, // 5 minutes
  }
);

// Multiple calls with same params = single request
const [data1, data2] = await Promise.all([
  getCachedData('123', true),
  getCachedData('123', true), // Same request, deduped
]);
```

### Immediate Starting Value

You can provide a `startingValue` function in the options. This function's return value will be served immediately on the initial request while the actual data is fetched in the background. This ensures the user never has to wait, even on the first load.

```typescript
const getCachedDataWithStartingValue = quick_cache(
    async (id: string) => {
        // This will be fetched in the background on the first call
        return await getRealData(id);
    },
    ['user-with-starting-value'],
    {
        revalidate: 60,
        // Return a starting value immediately
        startingValue: (id: string) => ({
            id,
            name: 'Loading...',
            isDefault: true,
        }),
    }
);

// First call: returns the starting user object instantly
const user = await getCachedDataWithStartingValue('456'); 

// Subsequent calls (after fetch completes) will return cached real data
```

### Cache Forever

```typescript
const getCachedConfig = quick_cache(
  async () => await fetchAppConfig(),
  ['config'],
  {
    revalidate: false, // Never expires
  }
);
```

### Disk Persistence

By default, cache entries are persisted to disk in the system's temp directory. This allows cache to survive process restarts and be shared across multiple processes. You can disable this behavior:

```typescript
const getCachedData = quick_cache(
  async (id: string) => await fetchData(id),
  ['data'],
  {
    revalidate: 60,
    persistToDisk: false, // Only keep in memory
  }
);
```

## How It Works

1. **First call**: Executes function, caches result
2. **Subsequent calls**: Returns cached data instantly
3. **After expiry**: Returns stale data immediately, fetches fresh data in background
4. **Concurrent calls**: Deduplicates requests, all callers get same Promise

## API

```typescript
quick_cache<TArgs, TReturn>(
  fetchData: (...args: TArgs) => Promise<TReturn>,
  keyParts?: readonly string[],
  options?: {
    tags?: string[];
    revalidate?: number | false;
    startingValue?: (...args: TArgs) => TReturn;
  }
): (...args: TArgs) => Promise<TReturn>
```

### Parameters

- `fetchData`: Async function to cache.
- `keyParts`: Additional cache key identification (optional).
- `options.revalidate`: Seconds until revalidation, or `false` to never expire.
- `options.startingValue`: A function that returns an immediate value if no cache is present. The data fetch will still run in the background.
- `options.persistToDisk`: Whether to persist cache to disk (default: `true`).
- `options.tags`: Tags for future cache invalidation support (future feature).

## License

CC0 1.0 Universal - Public Domain

This work is released into the public domain. You can copy, modify, and distribute it without any restrictions.
