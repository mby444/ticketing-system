import { Suspense } from 'react';
import LoginForm from './login-form';

// The form reads ?reset=1 through useSearchParams, which opts the subtree out of
// static rendering unless it is wrapped in a Suspense boundary. Without this the
// build fails with a missing-suspense-with-csr-bailout error.
const LoginPage = () => {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
};

export default LoginPage;