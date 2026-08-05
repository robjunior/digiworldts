/**
 * Weak-password blocklist. Rejects passwords that appear in the top ~300 of
 * every breach corpus of the last decade (rockyou, HIBP top-N, NCSC 100k).
 *
 * NIST 800-63B §5.1.1.2 explicitly recommends this: a small blocklist of
 * commonly-used, expected, or previously-compromised passwords catches the
 * cheapest attacks (credential-stuffing, dictionary sprays) that length +
 * argon2id do NOT — a 12-char argon2id hash of "password1234" is expensive to
 * crack but trivially guessable at the login endpoint.
 *
 * The list is kept in-memory as a Set for O(1) membership. Passwords are
 * normalized to lowercase before lookup so a stored `Password123` catches
 * `password123` / `PASSWORD123` / `PaSsWoRd123`. This is a coarse net —
 * the goal is "block the obvious", not "prove the password is strong".
 *
 * Also handles adjacent variants ("password1", "password12", ..., "password99")
 * without exploding the on-disk list: the normalizer strips trailing 1-2 digit
 * numeric suffixes before lookup, so all 100 variants collapse to one entry.
 */

/**
 * Curated top ~300 breached passwords. Sourced from the public NCSC 100k
 * breach dump + rockyou top slice. All entries are lowercased already.
 *
 * Adjacent numeric variants like `password1..99` collapse to the single
 * `password` entry via the digit-strip in `isCommonPassword`.
 */
const BLOCKED: ReadonlySet<string> = new Set<string>([
  // Absolute worst offenders
  'password', 'passwd', 'admin', 'administrator', 'root', 'user', 'guest',
  'test', 'demo', 'welcome', 'login', 'default',
  // Digit-only strings (numeric suffix stripping keeps the '1' entry small)
  '123456', '12345678', '123456789', '1234567890', '1234567',
  '111111', '000000', '654321', '121212', '112233', '123123', '789456',
  '987654', '696969', '159357', '789789', '456789',
  // Keyboard rows / patterns
  'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm',
  '1qaz2wsx', 'qwer1234', 'qazwsx', 'qwerty1', 'qweasd', 'qazwsxedc',
  '1q2w3e4r', '1q2w3e', 'q1w2e3r4', 'q1w2e3', 'qwe123', 'wsxedc',
  // "password"-family
  'p@ssw0rd', 'passw0rd', 'password!', 'password@', 'p@ssword',
  'password01', 'password123', 'password1234', 'password12345',
  // "letmein"-family
  'letmein', 'letmein!', 'letmein1', 'letme1n',
  // Emotive / common words
  'iloveyou', 'ilovemyself', 'ihateyou', 'sunshine', 'princess', 'monkey',
  'dragon', 'shadow', 'master', 'football', 'baseball', 'basketball',
  'superman', 'batman', 'starwars', 'freedom', 'trustno1', 'ninja',
  'lovely', 'summer', 'winter', 'autumn', 'spring', 'flower', 'butterfly',
  'chocolate', 'purple', 'orange', 'yellow', 'silver', 'diamond', 'crystal',
  'internet', 'computer', 'password', 'thebest', 'nothing', 'whatever',
  'jesus', 'jesus1', 'jesuschrist', 'god', 'satan', 'buddha', 'hello',
  'hi', 'hey',
  // Common first names
  'michael', 'jennifer', 'jessica', 'ashley', 'sarah', 'david', 'daniel',
  'joshua', 'andrew', 'anthony', 'mike', 'chris', 'kevin', 'brian',
  'thomas', 'robert', 'william', 'richard', 'joseph', 'charles', 'nicole',
  'amanda', 'melissa', 'elizabeth', 'stephanie', 'rebecca', 'laura',
  'kimberly', 'lisa', 'angela', 'brittany',
  // Sports teams / bands / brands (top offenders)
  'liverpool', 'arsenal', 'chelsea', 'manchester', 'barcelona', 'realmadrid',
  'lakers', 'yankees', 'cowboys', 'raiders',
  'metallica', 'nirvana', 'beatles', 'greenday', 'linkinpark',
  'pokemon', 'digimon', 'mario', 'zelda', 'sonic',
  // Portuguese common (BR/PT audience)
  'senha', 'minhasenha', 'euteamo', 'tequiero', 'meuamor', 'saudade',
  'coracao', 'brasil', 'brazil', 'flamengo', 'corinthians', 'palmeiras',
  'saopaulo', 'santos', 'gremio', 'internacional', 'atletico', 'cruzeiro',
  'fluminense', 'vasco', 'botafogo',
  'familia', 'amiga', 'amigo', 'amor', 'amoreterno', 'amordaminhavida',
  'deus', 'deusefiel', 'jesussalvador',
  'joao', 'maria', 'pedro', 'jose', 'francisco', 'antonio', 'carlos',
  'juliana', 'ana', 'fernanda', 'camila', 'mariana',
  // Spanish common
  'contrasena', 'hola', 'holamundo', 'teamo', 'quierote', 'estrella',
  'principe', 'princesa',
  // Placeholder / testing garbage
  'changeme', 'change_me', 'temp', 'temporary', 'temp1234', 'default1',
  'defaultpassword', 'defaultpass', 'test1234', 'test123', 'password!@#',
  'abc123', 'abcdef', 'abcd1234', 'aaaaaa', 'aaaaaaaa', 'iloveu',
  'foobar', 'foo', 'bar', 'baz', 'qwerty!', 'qwerty!@#',
  // Common English words often chosen as passwords
  'apple', 'orange', 'banana', 'grape', 'cherry',
  'hunter', 'hunter2',
  'coffee', 'sugar', 'honey', 'candy',
  'happy', 'happy1', 'lucky', 'blessed',
  'access', 'access1', 'action', 'active',
  'network', 'system', 'server',
  // OS / vendor defaults (very common in leaked corp lists)
  'oracle', 'oracle1', 'ora123', 'sa', 'sysadmin', 'toor',
  'cisco', 'cisco123',
  // Adjacent letter/digit combos
  '111222', '112211', '221122', 'aaa111', '123321', '321123', '123qwe',
  'qwe123', 'qwer1234', 'asd123', 'asdf1234', '1234qwer', '1234abcd',
  // Culturally-loaded easy-guess
  'obama', 'trump', 'biden',
  '9999', '99999', '999999', '11223344', '55555', '555555',
  // Repeats specific to game / anime audiences (this app is a game)
  'gamer', 'gaming', 'gg', 'ggwp', 'gameover',
  'anime', 'otaku', 'weeb', 'sasuke', 'naruto', 'goku', 'vegeta',
  'kirito', 'asuna',
]);

/**
 * Return true if `password` is one of the well-known weak passwords, or a
 * trivial suffix-numeric variant of one.
 */
export function isCommonPassword(password: string): boolean {
  if (typeof password !== 'string' || password.length === 0) return false;
  const lower = password.toLowerCase();
  if (BLOCKED.has(lower)) return true;
  // Collapse trailing 1-4 digit numeric suffixes: "password12" → "password".
  const stripped = lower.replace(/[0-9]{1,4}$/, '');
  if (stripped.length > 0 && stripped !== lower && BLOCKED.has(stripped)) return true;
  // Collapse trailing single punctuation ("password!" → "password").
  const noTrailPunct = lower.replace(/[!@#$%^&*.\-_]{1,3}$/, '');
  if (noTrailPunct.length > 0 && noTrailPunct !== lower && BLOCKED.has(noTrailPunct)) return true;
  return false;
}

/**
 * Return true if `password` (case-insensitive) contains `username` as a
 * substring — the top user-specific weak pattern ("alice" registers with
 * "alice123", "IAmAlice!", etc.). Guarded on username length ≥ 3 so we
 * don't accidentally reject every password containing 'a' or 'ab'.
 */
export function passwordContainsUsername(password: string, username: string): boolean {
  if (typeof password !== 'string' || typeof username !== 'string') return false;
  if (username.length < 3) return false;
  return password.toLowerCase().includes(username.toLowerCase());
}

/** For tests / diagnostics. */
export function __blocklistSize(): number {
  return BLOCKED.size;
}
