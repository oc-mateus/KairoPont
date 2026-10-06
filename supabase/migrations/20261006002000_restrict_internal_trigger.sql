-- The Auth trigger remains able to call this function, but API clients cannot invoke it.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
