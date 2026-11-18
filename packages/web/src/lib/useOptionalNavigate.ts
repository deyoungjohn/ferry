import {
  useInRouterContext,
  useNavigate,
  type NavigateFunction,
} from 'react-router';

/**
 * `useNavigate`, but usable by a component that some tests render without a router: there it falls
 * back to a full page load. Whether a router is present never changes for one mounted component, so
 * the hook order is stable.
 */
export function useOptionalNavigate(): NavigateFunction {
  const inRouter = useInRouterContext();
  if (inRouter) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useNavigate();
  }
  return ((to: string) => {
    window.location.assign(to);
  }) as unknown as NavigateFunction;
}
