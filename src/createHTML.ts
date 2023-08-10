import { MongoClient } from "mongodb";
import { createHTML } from './utils';
import { MONGO_DB } from "./config";


MongoClient.connect(MONGO_DB || "mongodb://localhost:27017?directConnection=true", {}).then(async (client) => {
    const db = client.db("fourb");
    await createHTML(db)
    process.exit()
})

