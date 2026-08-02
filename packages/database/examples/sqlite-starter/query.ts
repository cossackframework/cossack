import { createExampleORM } from "./database.js";
import { Post, User } from "./models/index.js";

export async function showResults(): Promise<void> {
  const orm = await createExampleORM();
  try {
    await orm.run(async () => {
      const users = await User.find({
        relations: ["posts"],
        order: { name: "asc" },
      });
      const posts = await Post.find({
        relations: ["author"],
        order: { createdAt: "asc" },
      });

      console.log("\nUsers with posts");
      console.log("================");
      for (const user of users) {
        console.log(`${user.name} <${user.email}>`);
        for (const post of user.posts) {
          console.log(`  - ${post.title} [${post.published ? "published" : "draft"}]`);
        }
      }

      console.log("\nPosts with authors");
      console.log("==================");
      for (const post of posts) {
        console.log(`${post.title} — ${post.author.name}`);
      }

      console.log(`\nTotals: ${users.length} users, ${posts.length} posts`);
    });
  } finally {
    await orm.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await showResults();
}
