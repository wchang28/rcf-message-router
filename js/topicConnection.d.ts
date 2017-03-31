/// <reference types="node" />
import * as rcf from 'rcf';
import * as events from 'events';
import { Socket } from 'net';
export interface Subscription {
    dest: string;
    hdrs?: {
        [field: string]: any;
    };
}
export interface ITopicConnectionJSON {
    id: string;
    cookie: any;
    subs: {
        [sub_id: string]: Subscription;
    };
    remoteAddress: string;
    remotePort: number;
    remoteFamily: string;
    localAddress: string;
    localPort: number;
    bytesRead: number;
    bytesWritten: number;
    destroyed: boolean;
}
export interface ITopicConnection {
    readonly id: string;
    cookie: any;
    readonly subs: {
        [sub_id: string]: Subscription;
    };
    readonly remoteAddress: string;
    readonly remotePort: number;
    readonly remoteFamily: string;
    readonly localAddress: string;
    readonly localPort: number;
    readonly bytesRead: number;
    readonly bytesWritten: number;
    readonly destroyed: boolean;
    destroy: () => void;
    triggerChangeEvent: () => void;
    toJSON: () => ITopicConnectionJSON;
}
export declare class TopicConnection extends events.EventEmitter implements ITopicConnection {
    private i;
    private s;
    private k;
    private u;
    private a;
    constructor(conn_id: string, socket: Socket, cookie: any, messageCB: rcf.MessageCallback, keepAliveIntervalMS?: number);
    triggerChangeEvent(): void;
    private emitMessage(msg);
    private matchDestination(destinationSubscribed, destinationMsg);
    private buildMsgForDispatching(sub_id, destination, headers, message);
    private getSubscriptionSelector(subscription);
    forwardMessage(destination: string, headers: {
        [field: string]: any;
    }, message: any): void;
    readonly subs: {
        [sub_id: string]: Subscription;
    };
    addSubscription(sub_id: string, destination: string, headers: {
        [field: string]: any;
    }): void;
    removeSubscription(sub_id: string): void;
    end(): void;
    readonly id: string;
    cookie: any;
    readonly remoteAddress: string;
    readonly remotePort: number;
    readonly remoteFamily: string;
    readonly localAddress: string;
    readonly localPort: number;
    readonly bytesRead: number;
    readonly bytesWritten: number;
    readonly destroyed: boolean;
    destroy(): void;
    toJSON(): ITopicConnectionJSON;
}
