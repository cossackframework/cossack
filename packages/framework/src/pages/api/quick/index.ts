export default (c: any) => {
  return c.json({
    message: 'Hello from a zero-config API route!',
    timestamp: new Date().toISOString(),
    method: c.req.method
  });
}

export const POST = async (c: any) => {
  const body = await c.req.json();
  return c.json({
    message: 'Post received!',
    echo: body
  }, 201);
}
