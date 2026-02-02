// Hono-style API routes
// The default export handles GET requests
export default (c: any) => {
    return c.json({
        success: true,
        payload: 'Hello from a custom API response!'
    }, 201, { 'X-Custom-Header': 'Cossack-Framework' });
};

// Named exports handle other HTTP methods
export const POST = async (c: any) => {
    const body = await c.req.json();
    return c.json({
        success: true,
        mirroredBody: body
    });
};

export const PUT = async (c: any) => {
    const validation = c.req.query('validation');
    if (!validation) {
        return c.json({ success: false, message: 'Validation query parameter is required' }, 400);
    }
    return c.json({ success: true, message: 'Validation passed!' });
};
