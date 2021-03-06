/* @flow
 * Derivation of addresses from HD nodes
 */

import type { HDNode } from 'bitcoinjs-lib';
import type { WorkerChannel } from './worker';

export type AddressSource = {
    derive(
        firstIndex: number,
        lastIndex: number
    ): Promise<Array<string>>;
};

export class NativeAddressSource {
    node: HDNode;

    constructor(node: HDNode) {
        this.node = node;
    }

    derive(firstIndex: number, lastIndex: number): Promise<Array<string>> {
        let addresses = [];
        for (let i = firstIndex; i <= lastIndex; i++) {
            addresses.push(this.node.derive(i).getAddress());
        }
        return Promise.resolve(addresses);
    }
}

export class WorkerAddressSource {
    channel: WorkerChannel;
    node: {
        depth: number;
        child_num: number;
        fingerprint: number;
        chain_code: Buffer;
        public_key: Buffer
    };
    version: number;

    constructor(channel: WorkerChannel, node: HDNode, version: number) {
        this.channel = channel;
        this.node = {
            depth: node.depth,
            child_num: node.index,
            fingerprint: node.parentFingerprint,
            chain_code: node.chainCode,
            public_key: node.keyPair.getPublicKeyBuffer(),
        };
        this.version = version;
    }

    derive(firstIndex: number, lastIndex: number): Promise<Array<string>> {
        let request = {
            type: 'deriveAddressRange',
            node: this.node,
            version: this.version,
            firstIndex,
            lastIndex,
        };
        return this.channel.postMessage(request)
            .then(({addresses}) => addresses);
    }
}

export class PrefatchingSource<T: AddressSource> {
    source: T;
    prefatched: ?{
        firstIndex: number;
        lastIndex: number;
        promise: Promise<Array<string>>;
    };

    constructor(source: T) {
        this.source = source;
        this.prefatched = null;
    }

    derive(firstIndex: number, lastIndex: number): Promise<Array<string>> {
        let promise;

        if (this.prefatched
            && this.prefatched.firstIndex === firstIndex
            && this.prefatched.lastIndex === lastIndex) {

            promise = this.prefatched.promise;
        } else {
            promise = this.source.derive(firstIndex, lastIndex);
        }
        this.prefatched = null;

        return promise.then((result) => {
            let nf = lastIndex + 1;
            let nl = lastIndex + 1 + (lastIndex - firstIndex);
            let next = this.source.derive(nf, nl);

            this.prefatched = {
                firstIndex: nf,
                lastIndex: nl,
                promise: next,
            };

            return result;
        });
    }
}

export type CachingSourceData = {
    cache: { [key: string]: Array<string> };
};

export class CachingSource<T: AddressSource> {
    source: T;
    cache: { [key: string]: Array<string> };

    constructor(source: T) {
        this.source = source;
        this.cache = Object.create(null);
    }

    store(): CachingSourceData {
        return { cache: this.cache };
    }

    restore(data: CachingSourceData) {
        this.cache = data.cache;
    }

    derive(firstIndex: number, lastIndex: number): Promise<Array<string>> {
        let key = `${firstIndex}-${lastIndex}`;

        if (this.cache[key] !== undefined) {
            return Promise.resolve(this.cache[key]);

        } else {
            return this.source.derive(firstIndex, lastIndex)
                .then((result) => this.cache[key] = result);
        }
    }
}
