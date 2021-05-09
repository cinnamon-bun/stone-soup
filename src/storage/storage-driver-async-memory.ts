import {
    Cmp
} from './util-types';
import {
    Doc,
    LocalIndex,
    Path,
    WorkspaceAddress
} from "../util/doc-types";
import {
    Query
} from "./query-types";
import {
    IStorageDriverAsync
} from "./storage-types";
import {
    InstanceIsNotReadyYetError,
    ValidationError
} from '../util/errors';

import {
    compareArrays,
    compareByObjKey,
    sortedInPlace,
} from './compare';
import {
    cleanUpQuery,
    docMatchesFilter
} from './query';
import {
    Lock
} from './lock';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('storage driver async memory', 'yellow');

//================================================================================

let combinePathAndAuthor = (doc: Doc) => {
    // This is used as a key into the path&author index
    // It must use a separator character that's not valid in either paths or author addresses
    return `${doc.path}|${doc.author}`;
}

let docComparePathASCthenNewestFirst = (a: Doc, b: Doc): Cmp => {
    // Sorts docs by path ASC.
    // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
    return compareArrays(
        [a.path, a.timestamp, a.signature],
        [b.path, b.timestamp, a.signature],
        ['ASC', 'DESC', 'ASC'],
    );
}

let docComparePathDESCthenNewestFirst = (a: Doc, b: Doc): Cmp => {
    // Sorts docs by path DESC.
    // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
    return compareArrays(
        [a.path, a.timestamp, a.signature],
        [b.path, b.timestamp, a.signature],
        ['DESC', 'DESC', 'ASC'],
    );
}

export class StorageDriverAsyncMemory implements IStorageDriverAsync {
    workspace: WorkspaceAddress;
    lock: Lock;
    _highestLocalIndex: LocalIndex = -1;
    _configKv: Record<string, string> = {};

    _isHatched: true | false | 'hatching' = false;
    _isClosed: boolean = false;
  
    // Our indexes.
    // These maps all share the same Doc objects, so memory usage is not bad.
    // The Doc objects are frozen.
    docByPathAndAuthor: Map<string, Doc> = new Map(); // path+author --> doc
    docsByPathNewestFirst: Map<Path, Doc[]> = new Map(); // path --> array of docs with that path, sorted newest first
  
    constructor(workspace: WorkspaceAddress) {
        logger.debug('constructor');
        this.workspace = workspace;
        this.lock = new Lock();
    }

    async hatch(): Promise<void> {
        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }
        if (this._isHatched === true || this._isHatched === 'hatching' ) { return; }
        this._isHatched = 'hatching';

        logger.debug('hatching');
        // do setup here

        this._isHatched = true;
    }
  
    async getConfig(key: string): Promise<string | undefined> {
        return this._configKv[key];
    }
    async setConfig(key: string, value: string): Promise<void> {
        this._configKv[key] = value;
    }
    async listConfigKeys(): Promise<string[]> {
        return sortedInPlace(Object.keys(this._configKv));
    }
    async deleteConfig(key: string): Promise<boolean> {
        let had = (key in this._configKv);
        delete this._configKv[key];
        return had;
    }

    getHighestLocalIndex() {
        logger.debug(`getHighestLocalIndex(): it's ${this._highestLocalIndex}`);
        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }
        return this._highestLocalIndex;
    }
  
    async _getAllDocs(): Promise<Doc[]> {
        // return in unsorted order
        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }
        return [...this.docByPathAndAuthor.values()];
    }
    async _getLatestDocs(): Promise<Doc[]> {
        // return in unsorted order
        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }
        let docs: Doc[] = [];
        for (let docArray of this.docsByPathNewestFirst.values()) {
            // this array is kept sorted newest-first
            docs.push(docArray[0]);
        }
        return docs;
    }

    async queryDocs(queryToClean: Query): Promise<Doc[]> {
        // Query the documents.

        logger.debug('queryDocs', queryToClean);
        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }

        // clean up the query and exit early if possible.
        let { query, willMatch } = cleanUpQuery(queryToClean);
        logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
        if (willMatch === 'nothing') { return []; }

        // get history docs or all docs
        logger.debug(`    getting docs; historyMode = ${query.historyMode}`);
        let docs = query.historyMode === 'all'
            ? await this._getAllDocs()   // don't sort it here,
            : await this._getLatestDocs();  // we'll sort it below

        // orderBy
        logger.debug(`    ordering docs: ${query.orderBy}`);
        if (query.orderBy === 'path ASC') {
            docs.sort(docComparePathASCthenNewestFirst);
        } else if (query.orderBy === 'path DESC') {
            docs.sort(docComparePathDESCthenNewestFirst);
        } else if (query.orderBy === 'localIndex ASC') {
            docs.sort(compareByObjKey('_localIndex', 'ASC'));
        } else if (query.orderBy === 'localIndex DESC') {
            docs.sort(compareByObjKey('_localIndex', 'DESC'));
        } else {
            throw new ValidationError('unrecognized query orderBy: ' + JSON.stringify(query.orderBy));
        }

        let filteredDocs: Doc[] = [];
        logger.debug(`    filtering docs`);
        for (let doc of docs) {
            // skip ahead until we pass continueAfter
            if (query.orderBy === 'path ASC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.path !== undefined && doc.path < query.startAt.path) { continue; }
                    // doc.path is now >= startAt.path
                }
            }
            if (query.orderBy === 'path DESC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.path !== undefined && doc.path > query.startAt.path) { continue; }
                    // doc.path is now <= startAt.path (we're descending)
                }
            }
            if (query.orderBy === 'localIndex ASC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) < query.startAt.localIndex) { continue; }
                    // doc.path is now >= startAt.localIndex
                }
            }
            if (query.orderBy === 'localIndex DESC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) > query.startAt.localIndex) { continue; }
                    // doc.path is now <= startAt.localIndex (we're descending)
                }
            }

            // apply filter: skip docs that don't match
            if (query.filter && !docMatchesFilter(doc, query.filter)) { continue; }

            // finally, here's a doc we want
            filteredDocs.push(doc);

            // stop when hitting limit
            if (query.limit !== undefined && filteredDocs.length >= query.limit) {
                logger.debug(`    ....hit limit of ${query.limit}`);
                break;
            }
        }

        logger.debug(`    queryDocs is done: found ${filteredDocs.length} docs`);
        return filteredDocs;
    }
  
    async upsert(doc: Doc): Promise<Doc> {
        // add a doc.  don't enforce any rules on it.
        // overwrite existing doc even if this doc is older.
        // return a copy of the doc, frozen, with _localIndex set.

        if (this._isClosed) { throw new InstanceIsNotReadyYetError(); }

        doc = {...doc};
        this._highestLocalIndex += 1;
        doc._localIndex = this._highestLocalIndex;
        Object.freeze(doc);

        logger.debug('upsert', doc);
  
        // save into our various indexes and data structures

        this.docByPathAndAuthor.set(combinePathAndAuthor(doc), doc);

        // get list of history docs at this path
        let docsByPath = this.docsByPathNewestFirst.get(doc.path) || [];
        // remove existing doc from same author same path
        docsByPath = docsByPath.filter(d => d.author !== doc.author);
        // add this new doc
        docsByPath.push(doc);
        // sort newest first within this path
        docsByPath.sort(docComparePathASCthenNewestFirst);
        // save the list back to the index
        this.docsByPathNewestFirst.set(doc.path, docsByPath);
  
        return doc;
    }

    isClosed(): boolean {
        return this._isClosed;
    }
    async close(): Promise<void> {
        logger.debug('closing');
        this._isClosed = true;
    }
}
