import { Suspense } from 'react';
import ForgotPasswordForm from './forgot-password-form';

// The form reads ?step=code through useSearchParams, which opts the subtree out
// of static rendering unless it is wrapped in a Suspense boundary.
const ForgotPasswordPage = () => {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
};

export default ForgotPasswordPage;