export { Post } from "./Post.js";
export { User } from "./User.js";

import { Post } from "./Post.js";
import { User } from "./User.js";

export const entities = [User, Post] as const;
