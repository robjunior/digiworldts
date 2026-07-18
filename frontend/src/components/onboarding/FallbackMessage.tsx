type FallbackMessageProps = {
  readonly visible: boolean;
};

export function FallbackMessage({ visible }: FallbackMessageProps): JSX.Element {
  return (
    <div id="fallback-msg" className={visible ? 'fallback-msg' : 'fallback-msg hidden'}>
      <h3>Admin setup required</h3>
      <p>Admin has not configured onboarding yet — try again later or contact the admin.</p>
      <a href="/login" className="btn btn--wide">
        Return to login
      </a>
    </div>
  );
}
