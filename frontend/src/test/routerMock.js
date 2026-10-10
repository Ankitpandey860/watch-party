// Shared factory for mocking @tanstack/react-router in component tests (page tests need only these hooks).
export async function makeRouterMock({ navigate, search = {}, params = {} }) {
  const React = await import("react");
  return {
    useNavigate: () => navigate,
    useSearch: () => (typeof search === "function" ? search() : search),
    useParams: () => (typeof params === "function" ? params() : params),
    Link: ({ to, children, ...rest }) =>
      React.createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children),
  };
}
