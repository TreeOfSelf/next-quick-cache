# next-quick-cache

A lightweight TypeScript cache library with stale-while-revalidate support. Drop-in replacement for Next.js `unstable_cache` that works anywhere. 

The motivation for this was that I noticed unstable_cache has issues where if a process to revalidate is extremely heavy, it would run multiple processes if multiple people needed revalidations at once. It also would wait instead of serving stale data, which may end up having the user wait a long time. This solves that. 

## Features

- **Stale-while-revalidate** - Serves cached data instantly while fetching fresh data in background
- **Request deduplication** - Prevents multiple identical requests from running simultaneously  
- **TypeScript support** - Full type safety with generics
- **Simple API** - Same interface as Next.js `unstable_cache`
- **Universal** - Works in any JavaScript environment, not just Next.js

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
  }
): (...args: TArgs) => Promise<TReturn>
```

### Parameters

- `fetchData`: Async function to cache
- `keyParts`: Additional cache key identification (optional)
- `options.revalidate`: Seconds until revalidation, or `false` to never expire
- `options.tags`: Tags for future cache invalidation support

## License

CC0 1.0 Universal - Public Domain

This work is released into the public domain. You can copy, modify, and distribute it without any restrictions.
