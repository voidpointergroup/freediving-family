import * as db_lib_types from '../../../libs/db/src/types'

export interface Account extends db_lib_types.WithID<string>, db_lib_types.WithTimestamps {
    name: string,
}
