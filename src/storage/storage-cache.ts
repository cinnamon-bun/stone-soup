import { AuthorKeypair, Doc, DocToSet, Path } from "../util/doc-types";
import { isErr, InstanceIsNotReadyYetError } from "../util/errors";
import { microsecondNow } from "../util/misc";
import { docMatchesFilter, cleanUpQuery } from "./query";
import { QueryFollower } from "./query-follower";
import { Query } from "./query-types";
import { StorageAsync } from "./storage-async";
import { IngestResult, IngestResultAndDoc } from "./storage-types";
import isEqual from "fast-deep-equal";
import stringify from 'fast-json-stable-stringify'

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('storage cache', 'cyan');

//================================================================================

// A synchronous, limited version of a storage.

// Lifted from StorageDriverAsyncMemory
// Slightly different in that it does not check if doc matches the filter,
// as this has been done beforehand by now.
function sortAndLimit(query: Query, docs: Doc[]) {
  let filteredDocs: Doc[] = [];

  for (let doc of docs) {
    if (query.orderBy === "path ASC") {
      if (query.startAt !== undefined) {
        if (query.startAt.path !== undefined && doc.path < query.startAt.path) {
          continue;
        }
        // doc.path is now >= startAt.path
      }
    }
    if (query.orderBy === "path DESC") {
      if (query.startAt !== undefined) {
        if (query.startAt.path !== undefined && doc.path > query.startAt.path) {
          continue;
        }
        // doc.path is now <= startAt.path (we're descending)
      }
    }
    if (query.orderBy === "localIndex ASC") {
      if (query.startAt !== undefined) {
        if (
          query.startAt.localIndex !== undefined &&
          (doc._localIndex || 0) < query.startAt.localIndex
        ) {
          continue;
        }
        // doc.path is now >= startAt.localIndex
      }
    }
    if (query.orderBy === "localIndex DESC") {
      if (query.startAt !== undefined) {
        if (
          query.startAt.localIndex !== undefined &&
          (doc._localIndex || 0) > query.startAt.localIndex
        ) {
          continue;
        }
        // doc.path is now <= startAt.localIndex (we're descending)
      }
    }

    // finally, here's a doc we want
    filteredDocs.push(doc);

    // stop when hitting limit
    if (query.limit !== undefined && filteredDocs.length >= query.limit) {
      break;
    }
  }

  return filteredDocs;
}

export class StorageCache {
  _storage: StorageAsync;

  _docCache = new Map<string, { docs: Doc[]; follower: QueryFollower, expires: number }>();
  
  _timeToLive: number;

  _onCacheUpdatedCallbacks = new Set<() => void | (() => Promise<void>)>();

  constructor(storage: StorageAsync, timeToLive?: number) {
    this._storage = storage;
    this._timeToLive = timeToLive || 1000
  }

  // GET

  getAllDocs(): Doc[] {
    if (this._storage.isClosingOrClosed()) {
      throw new InstanceIsNotReadyYetError();
    }
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
    });
  }

  getLatestDocs(): Doc[] {
    if (this._storage.isClosingOrClosed()) {
      throw new InstanceIsNotReadyYetError();
    }
    return this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
    });
  }

  getAllDocsAtPath(path: Path): Doc[] {
    if (this._storage.isClosingOrClosed()) {
      throw new InstanceIsNotReadyYetError();
    }
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
      filter: { path: path },
    });
  }

  getLatestDocAtPath(path: Path): Doc | undefined {
    if (this._storage.isClosingOrClosed()) {
      throw new InstanceIsNotReadyYetError();
    }
    let docs = this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
      filter: { path: path },
    });
    if (docs.length === 0) {
      return undefined;
    }
    return docs[0];
  }

  queryDocs(query: Query = {}): Doc[] {
    // make a deterministic string out of the query
    let cleanUpQueryResult = cleanUpQuery(query);

    if (cleanUpQueryResult.willMatch === "nothing") {
      return [];
    }

    let queryString = stringify(cleanUpQueryResult.query);

    // Check if the cache has anything from this
    // and if so, return it.
    const cachedResult = this._docCache.get(queryString);

    if (cachedResult) {
      // Query the storage, set the eventual result in the cache.
      this._storage.queryDocs(query).then((docs) => {
        this._docCache.set(queryString, { ...cachedResult, docs });
      });
      
      if (Date.now() > cachedResult.expires) {
        this._storage.queryDocs(query).then((docs) => {
          this._docCache.set(queryString, { follower, docs, expires: Date.now() + this._timeToLive });
          logger.debug("⌛️");
          this._fireOnCacheUpdateds();
        });
      }

      return cachedResult.docs;
    }

    let follower = new QueryFollower(
      this._storage,
      { ...query, historyMode: "all", orderBy: "localIndex ASC" },
      (doc) => {
        return new Promise((resolve) => {
          logger.debug("🐣");
          this._updateCacheOptimistically(doc);
          return resolve();
        });
      }
    );

    // Add an entry to the cache.
    this._docCache.set(queryString, {
      docs: [],
      follower,
      expires: Date.now() + this._timeToLive
    });

    // Hatch the follower.
    follower.hatch();
    
    this._storage.queryDocs(query).then((docs) => {
      this._docCache.set(queryString, { follower, docs, expires: Date.now() + this._timeToLive });
      logger.debug("👹");
      this._fireOnCacheUpdateds();
    });

    // Return an empty result for the moment.
    return [];
  }

  // SET

  // Do a version of set which assumes this will be latest, and add that doc to the cache.
  // In the meantime, call set on the backing storage, and update results after.
  set(keypair: AuthorKeypair, docToSet: DocToSet): IngestResultAndDoc {
    if (this._storage.isClosingOrClosed()) {
      throw new InstanceIsNotReadyYetError();
    }

    let doc: Doc = {
      format: "es.4",
      author: keypair.address,
      content: docToSet.content,
      contentHash: this._storage.formatValidator.crypto.sha256base32(
        docToSet.content
      ),
      deleteAfter: null,
      path: docToSet.path,
      timestamp: microsecondNow(),
      workspace: this._storage.workspace,
      signature: "?",
    };

    let signedDoc = this._storage.formatValidator.signDocument(keypair, doc);
    if (isErr(signedDoc)) {
      return { ingestResult: IngestResult.Invalid, docIngested: null };
    }

    // Update the cache optimistically
    logger.debug("🚂");
    this._updateCacheOptimistically(signedDoc);

    // Set with actual storage.
    this._storage.set(keypair, docToSet);

    // Assume this is accepted and latest for the moment.
    return {
      docIngested: signedDoc,
      ingestResult: IngestResult.AcceptedAndLatest,
    };
  }

  // CACHE

  // Update cache entries as best as we can until results from the backing storage arrive.
  _updateCacheOptimistically(doc: Doc): void {
    this._docCache.forEach((entry, key) => {
      const query: Query = JSON.parse(key);

      /*
      IF at least one document with same path is present
        AND historymode is latest
          AND doc has different author
            REPLACE
          OR doc has same author
            AND is different otherwise
              REPLACE
            OR is the same
              NOOP
        OR history mode is all
          AND doc has same author
            REPLACE one with same a
          OR doc has different author
            REPLACE
          
       
      OR zero documents with the same path
        AND query has a filter
          AND doc matches filter
            APPEND
          OR does not match filter
            NOOP
        OR query has no filter 
          APPEND
     */

      const appendDoc = () => {
        logger.debug("🥞");
        let nextDocs = [...entry.docs, doc];
        this._docCache.set(key, { ...entry, docs: sortAndLimit(query, nextDocs) });
        this._fireOnCacheUpdateds();
      };

      const replaceDoc = ({ exact }: { exact: boolean }) => {
        logger.debug("🔄");
        const nextDocs = entry.docs.map((existingDoc) => {
          if (
            exact &&
            existingDoc.path === doc.path &&
            existingDoc.author === doc.author
          ) {
            return doc;
          } else if (!exact && existingDoc.path === doc.path) {
            return doc;
          }

          return existingDoc;
        });

        this._docCache.set(key, { ...entry, docs: sortAndLimit(query,nextDocs) });
        this._fireOnCacheUpdateds();
      };

      const documentsWithSamePath = entry.docs.filter(
        (existingDoc) => existingDoc.path === doc.path
      );
      const documentsWithSamePathAndAuthor = entry.docs.filter(
        (existingDoc) =>
          existingDoc.path === doc.path && existingDoc.author === doc.author
      );

      if (documentsWithSamePath.length === 0) {
        if (
          (query.filter && docMatchesFilter(doc, query.filter)) ||
          !query.filter
        ) {
          appendDoc();
        }
        return;
      }

      const historyMode = query.historyMode || "latest";

      if (historyMode === "all") {
        if (documentsWithSamePathAndAuthor.length === 0) {
          appendDoc();
          return;
        }

        logger.debug('🕰')
        replaceDoc({ exact: true });
        return;
      }

      const latestDoc = documentsWithSamePath[0];

      const docIsDifferent =
        doc.author !== latestDoc?.author || isEqual(doc, latestDoc);

      if (docIsDifferent) {
        logger.debug('⌚️')
        replaceDoc({ exact: false });
        return;
      }
    });
  }

  // SUBSCRIBE

  _fireOnCacheUpdateds() {
    return Promise.all(
      Array.from(this._onCacheUpdatedCallbacks.values()).map((callback) => {
        return callback();
      })
    );
  }

  // Provide a function to be called when the storage cache knows its caller has stale results.
  onCacheUpdated(callback: () => void | (() => Promise<void>)): () => void {
    this._onCacheUpdatedCallbacks.add(callback);

    return () => {
      this._onCacheUpdatedCallbacks.delete(callback);
    };
  }
}
