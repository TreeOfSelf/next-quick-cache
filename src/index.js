"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = getCachedData;
const cache = new Map();
const inFlightRequests = new Map();
function getCachedData(_a) {
    return __awaiter(this, arguments, void 0, function* ({ key, retrieveFn, retrieveParams, opts = { revalidate: 60, serveStale: true } }) {
        const cacheKey = key;
        const cachedEntry = cache.get(cacheKey);
        if (inFlightRequests.has(cacheKey))
            return inFlightRequests.get(cacheKey);
        if (cachedEntry) {
            if (cachedEntry.revalidate != 0 && Date.now() > cachedEntry.expiry) {
                const revalidationPromise = revalidateInBackground({
                    retrieveFn,
                    cacheKey,
                    retrieveParams,
                    revalidate: opts.revalidate
                });
                if (!opts.serveStale)
                    return revalidationPromise;
            }
            return cachedEntry.data;
        }
        const requestPromise = (() => __awaiter(this, void 0, void 0, function* () {
            try {
                const freshData = yield retrieveFn(...retrieveParams);
                cache.set(cacheKey, {
                    data: freshData,
                    expiry: Date.now() + opts.revalidate * 1000,
                    revalidate: opts.revalidate
                });
                return freshData;
            }
            finally {
                inFlightRequests.delete(cacheKey);
            }
        }))();
        inFlightRequests.set(cacheKey, requestPromise);
        return requestPromise;
    });
}
const revalidateInBackground = (_a) => __awaiter(void 0, [_a], void 0, function* ({ retrieveFn, cacheKey, retrieveParams, revalidate }) {
    if (inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey);
    }
    const requestPromise = (() => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const freshData = yield retrieveFn(...retrieveParams);
            cache.set(cacheKey, {
                data: freshData,
                expiry: Date.now() + revalidate * 1000,
                revalidate
            });
            return freshData;
        }
        finally {
            inFlightRequests.delete(cacheKey);
        }
    }))();
    inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise;
});
