export interface WithID<T> {
    _id: T,
}

export interface dbAccount extends WithID<string> {
    name: string,
}
