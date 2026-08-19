export const DIALOGUE_SCHEMA_VERSION = 2 as const;

export type DialogueValueRef =
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'fact'; readonly name: string };

export type DialogueCondition =
  | { readonly kind: 'all'; readonly of: readonly DialogueCondition[] }
  | { readonly kind: 'any'; readonly of: readonly DialogueCondition[] }
  | { readonly kind: 'not'; readonly of: DialogueCondition }
  | { readonly kind: 'predicate'; readonly name: string; readonly args: readonly DialogueValueRef[] }
  | {
      readonly kind: 'compare';
      readonly left: DialogueValueRef;
      readonly op: '==' | '!=' | '<' | '<=' | '>' | '>=';
      readonly right: DialogueValueRef;
    };

export type DialogueAction = {
  readonly id: string;
  readonly name: string;
  readonly args: readonly DialogueValueRef[];
};

export type DialogueTextPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'variable'; readonly name: string };

export type DialogueSpeaker = {
  readonly npcId: string;
  readonly expression: string;
};

export type DialogueChoice = {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly condition: DialogueCondition | null;
};

export type DialogueJump = {
  readonly target: string;
  readonly condition: DialogueCondition | null;
};

export type DialogueNode = {
  readonly id: string;
  readonly tags: readonly string[];
  readonly speaker: DialogueSpeaker | null;
  readonly condition: DialogueCondition | null;
  readonly text: readonly DialogueTextPart[];
  readonly entryActions: readonly DialogueAction[];
  readonly jumps: readonly DialogueJump[];
  readonly choices: readonly DialogueChoice[];
};

export type DialogueDefinition = {
  readonly schemaVersion: typeof DIALOGUE_SCHEMA_VERSION;
  readonly dialogueId: string;
  readonly title: string;
  readonly startNodeId: string;
  readonly npcIds: readonly string[];
  /** Security gate: true when any node carries an action or a condition, so the client must never resolve this dialogue on its own. */
  readonly requiresServerAdvance: boolean;
  readonly nodes: Readonly<Record<string, DialogueNode>>;
  /** Content lifecycle status: draft (default) or published. Only published dialogues are visible to players. */
  readonly status: 'draft' | 'published';
};

export const DIALOGUE_END_NODE = 'END' as const;

export type DialogueDiagnostic = {
  readonly line: number;
  readonly passage: string | null;
  readonly message: string;
};

export type DialogueParseResult = {
  readonly definition: DialogueDefinition | null;
  readonly errors: readonly DialogueDiagnostic[];
  readonly warnings: readonly DialogueDiagnostic[];
  readonly stats: DialogueParseStats;
};

export type DialogueParseStats = {
  readonly nodes: number;
  readonly choices: number;
  readonly actions: number;
  readonly conditions: number;
  readonly jumps: number;
  readonly speakers: number;
};
