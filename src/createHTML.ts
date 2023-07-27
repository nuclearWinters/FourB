import { MongoClient } from "mongodb";
import { createHTML } from './utils';


MongoClient.connect("mongodb://localhost:27017?directConnection=true", {}).then(async (client) => {
    const db = client.db("fourb");
    createHTML(db)
})

