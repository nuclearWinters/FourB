export const MONGO_DB = process.env.MONGO_DB || "mongodb://mongo-fourb:27017";
export const REFRESH_TOKEN_EXP_NUMBER = 43200;
export const ACCESS_TOKEN_EXP_NUMBER = 900;
export const REFRESHSECRET = process.env.REFRESHSECRET || "REFRESHSECRET";
export const ACCESSSECRET = process.env.ACCESSSECRET || "ACCESSSECRET";
export const NODE_ENV = process.env.NODE_ENV || "development";
export const VIRTUAL_HOST = process.env.VIRTUAL_HOST