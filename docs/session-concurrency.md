# Concurrent sessions and flash state

Database session bags mutate one key with a single database statement. Two requests that change different keys preserve both changes. For the same key, the last committed write wins. Reading a bag does not reserve it: a request's earlier snapshot can be stale when its later write runs. Coordinate multi-key invariants with an application transaction or another serialization mechanism.

Auth-managed rotation uses the session store's atomic full-record replacement. Two requests rotating the same token have one winner. Only the winner issues a replacement cookie. The old token no longer validates. Rotate through your auth provider, not the anonymous bag's `bindUser` method.

Anonymous `session().bindUser(userId)` performs several steps: read the bag, create a replacement, copy keys, associate the user, and delete the original. These steps are not an atomic replacement. Concurrent upgrades can produce two valid replacement bags, and a concurrent write or deletion can change which data each copy sees. Serialize upgrades for the same anonymous session in your application. Do not use this helper as an authentication rotation primitive.

Revocation prevents later requests from authenticating with the revoked token. It does not cancel a handler already admitted by authentication middleware or roll back that handler's writes. For a sensitive operation whose authorization must remain valid until its commit, revalidate inside the operation and enforce the authorization condition atomically with its write. A storage commit and an HTTP response are separate events. A later response failure does not undo a committed session change.

Signed flash state has a short expiry and a unique claim identifier. Overlapping consuming requests yield the message to one request. Later replay yields no message. Signing protects integrity, not confidentiality. Node uses a bounded process-local replay guard: this guarantee does not span independent processes or process restarts. Workers use the configured `COSSACK_SSE` Durable Object claim coordinator and fail closed if it is unavailable.
