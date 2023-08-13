import { Collection, ObjectId } from "mongodb";

export interface UserMongo {
    _id?: ObjectId;
    email: string;
    password: string;
    cart_id: ObjectId;
    name: string;
    apellidos: string;
    phone: string;
    conekta_id: string;
    default_address: ObjectId | null;
    addresses: AddressUser[]
    phone_prefix: string;
    is_admin: boolean;
}

export interface AddressUser {
    _id: ObjectId;
    full_address: string;
    country: string;
    street: string;
    colonia: string;
    zip: string;
    city: string;
    state: string;
    phone: string;
    phone_prefix: string;
    name: string;
    apellidos: string;
}

export interface AddressUserJWT {
    _id: string;
    full_address: string;
    country: string;
    street: string;
    colonia: string;
    zip: string;
    city: string;
    state: string;
    phone: string;
    name: string;
    apellidos: string;
}

export interface SessionMongo {
    _id?: ObjectId;
    email: string | null;
    cart_id: ObjectId;
    name: string | null;
    apellidos: string | null;
    phone: string | null;
    conekta_id: string | null;
    country: string | null;
    street: string | null;
    colonia: string | null;
    zip: string | null;
    city: string | null;
    state: string | null;
    phone_prefix: string | null;
}

export interface InventoryMongo {
    _id?: ObjectId;
    available: number;
    total: number;
    name: string;
    price: number;
    img: string[];
    discount_price: number;
    use_discount: boolean;
    tags: string[]
    code: string;
    img_small: string[];
    img_big: string[];
    use_small_and_big: boolean;
}

export interface ItemsByCartMongo {
    _id?: ObjectId;
    product_id: ObjectId,
    cart_id: ObjectId,
    qty: number;
    price: number;
    discount_price: number;
    use_discount: boolean;
    name: string;
    img: string[];
    code: string;
    img_small: string[];
    img_big: string[];
    use_small_and_big: boolean;
}

export interface PurchasesMongo {
    _id?: ObjectId;
    product_id: ObjectId,
    qty: number;
    price: number;
    discount_price: number;
    use_discount: boolean;
    name: string;
    user_id: ObjectId | null;
    session_id: ObjectId;
    date: Date;
    img: string[];
    code: string;
    img_small: string[];
    img_big: string[];
    use_small_and_big: boolean;
}

export interface CartsByUserMongo {
    _id?: ObjectId;
    user_id: ObjectId;
    expireDate: Date | null;
}

export interface ReservedInventoryMongo {
    _id?: ObjectId;
    cart_id: ObjectId;
    product_id: ObjectId;
    qty: number;
}

export interface ContextLocals {
    users: Collection<UserMongo>;
    inventory: Collection<InventoryMongo>;
    itemsByCart: Collection<ItemsByCartMongo>;
    cartsByUser: Collection<CartsByUserMongo>;
    reservedInventory: Collection<ReservedInventoryMongo>;
    sessions: Collection<SessionMongo>
    purchases: Collection<PurchasesMongo>
}

export interface UserJWT {
    _id: string;
    cart_id: string;
    is_admin: boolean;
}

export interface SessionCookie {
    _id: string;
    email: string | null;
    cart_id: string;
    name: string | null;
    apellidos: string | null;
    phone: string | null;
    conekta_id: string | null;
    default_address: string | null;
    addresses: AddressUserJWT[];
    phone_prefix: string | null;
}

export interface DecodeJWT {
    user: UserJWT;
    iat: number;
    exp: number;
    refreshTokenExpireTime: number;
}