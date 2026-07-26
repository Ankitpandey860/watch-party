// Wraps an async Express route handler so thrown/rejected errors reach errorHandler middleware.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
