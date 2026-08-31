import Dexie, { type Table } from 'dexie';

export interface Chat {
    id: string;
    title: string;
    updatedAt: number;
}

export interface Message {
    id?: number;
    chatId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class QuarkDB extends Dexie {
    chats!: Table<Chat>;
    messages!: Table<Message>;

    constructor() {
        super('QuarkInferenceDB');
        this.version(1).stores({
            chats: 'id, updatedAt',
<<<<<<< HEAD
            messages: '++id, chatId, timestamp'
=======
            messages: '++id, chatId, timestamp',
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
        });
    }
}

<<<<<<< HEAD
export const db = new QuarkDB();
=======
export const db = new QuarkDB();
>>>>>>> 2f6d6f3 (	new file:   .clang-format)
