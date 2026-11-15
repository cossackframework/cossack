/** A functional HTTP route: its body never reaches the browser. */
export const GET = () => new Response('KIT_API_SECRET');
