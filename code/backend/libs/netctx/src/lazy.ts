export class Lazy<T> {
    private _initialized = false
    private _field: T | undefined = undefined

    constructor(private _factory: () => T) {}

    public instance(): T {
        if (!this._initialized) {
            this._field = this._factory()
            this._initialized = true
        }
        return this._field!
    }
}
