// Serialize transactions like Firestore's retry-on-conflict behavior.
export class Store {
  rows = new Map()
  tail = Promise.resolve()
  collection(path) {return {doc: id => this.doc(path + '/' + id)}}
  doc(path) {
    return {id: path.split('/').at(-1), path, collection: name => this.collection(path + '/' + name),
      get: async () => this.snap(path)}
  }
  snap(path) {
    const value = this.rows.get(path)
    return {id: path.split('/').at(-1), exists: !!value, data: () => structuredClone(value)}
  }
  runTransaction(callback) {
    const result = this.tail.then(async () => {
      const writes = []
      const tx = {get: async ref => this.snap(ref.path),
        set: (ref, value, options) => writes.push([ref.path, options?.merge ? {...this.rows.get(ref.path), ...structuredClone(value)} : structuredClone(value)]),
        create: (ref, value) => writes.push([ref.path, structuredClone(value)]),
        update: (ref, value) => writes.push([ref.path, {...this.rows.get(ref.path), ...structuredClone(value)}])}
      const output = await callback(tx)
      for (const [key, value] of writes) this.rows.set(key, value)
      return output
    })
    this.tail = result.catch(() => {})
    return result
  }
}
