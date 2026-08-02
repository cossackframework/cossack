import { defineSeeder } from "../../../src/index.js";
import { Post, User } from "../models/index.js";

const users = [
  {
    email: "ada@example.com",
    name: "Ada Lovelace",
    posts: [
      {
        slug: "analytical-engine",
        title: "Programming the Analytical Engine",
        body: "A short note about algorithms, symbols, and general-purpose computation.",
        published: true,
      },
      {
        slug: "poetical-science",
        title: "Poetical Science",
        body: "Imagination is a powerful companion to rigorous technical thought.",
        published: true,
      },
    ],
  },
  {
    email: "grace@example.com",
    name: "Grace Hopper",
    posts: [
      {
        slug: "debugging-with-curiosity",
        title: "Debugging with Curiosity",
        body: "The most useful question in a debugging session is often: why?",
        published: false,
      },
    ],
  },
] as const;

export const databaseSeeder = defineSeeder({
  name: "database",
  transaction: "auto",

  async run() {
    for (const input of users) {
      let user = await User.findOne({ where: { email: input.email } });
      if (!user) {
        user = User.create({ email: input.email, name: input.name });
        await user.save();
      } else if (user.name !== input.name) {
        user.name = input.name;
        await user.save();
      }

      for (const postInput of input.posts) {
        let post = await Post.findOne({ where: { slug: postInput.slug } });
        if (!post) {
          post = Post.create({
            slug: postInput.slug,
            title: postInput.title,
            body: postInput.body,
            published: postInput.published,
          });
          post.author = user;
          await post.save();
        }
      }
    }
  },
});
