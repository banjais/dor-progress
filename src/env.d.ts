/// <reference types="vite/client" />

// Declare global variables injected by build tools or available in the Worker environment
declare const WORKER_BASE: string;

// Extend the Vite environment variable types for better IDE support and type safety
interface ImportMetaEnv {
  readonly VITE_WORKER_BASE: string;
  readonly VITE_APP_ENV: string;
  readonly VITE_APP_CHECK_DEBUG_TOKEN: string;
  readonly VITE_FIREBASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface SpeechGrammar {
  src: string;
  weight: number;
}

interface SpeechGrammarList {
  readonly length: number;
  item(index: number): SpeechGrammar;
  addFromHref(uri: string, weight?: number): void;
  addFromString(string: string, weight?: number): void;
  [index: number]: SpeechGrammar;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode; // This type is now correctly inferred from lib.dom.d.ts
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  grammars: SpeechGrammarList;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any)
    | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any)
    | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

// Declare browser APIs for Speech Recognition (required for SearchManager/SpeechEngine)
interface Window {
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}

declare module "*.css";
