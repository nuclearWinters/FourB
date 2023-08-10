import 'dotenv/config'

export const MONGO_DB = process.env.MONGO_DB;
export const REFRESH_TOKEN_EXP_NUMBER = 43200;
export const ACCESS_TOKEN_EXP_NUMBER = 900;
export const REFRESHSECRET = process.env.REFRESHSECRET || "REFRESHSECRET";
export const ACCESSSECRET = process.env.ACCESSSECRET || "ACCESSSECRET";
export const VIRTUAL_HOST = process.env.VIRTUAL_HOST
export const PORT = process.env.PORT || 8000
export const ACCESS_KEY = process.env.ACCESS_KEY || ""
export const SECRET_KEY = process.env.SECRET_KEY || ""
export const REGION = process.env.REGION || ""
export const CONEKTA_API_KEY = process.env.CONEKTA_API_KEY || ""
export const BUCKET_NAME = process.env.BUCKET_NAME || ""