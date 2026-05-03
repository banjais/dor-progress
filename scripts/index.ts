/**
 * Backend Registry Validator
 * This script is called by GitHub Actions to ensure all AI flows/tools load correctly.
 */
import '../ai/flows/index.js';
import { ai } from '../ai/genkit.js';

console.log('🔍 Checking AI Registry Status...');
const actions = ai.registry.listActions();
console.log(`✅ Registered ${actions.length} AI actions (flows/tools).`);