import type { AIProvider, ProviderId } from '@/lib/types';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleProvider } from './GoogleProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { DemoProvider } from './DemoProvider';

/**
 * Point d'entrée unique pour obtenir un provider.
 *
 * Pour ajouter un nouveau fournisseur d'IA à l'avenir :
 *   1. Créez une classe qui implémente `AIProvider` (voir src/lib/types.ts).
 *   2. Instanciez-la ci-dessous et ajoutez-la au registre.
 *   3. Ajoutez ses métadonnées dans src/lib/config/models.ts.
 * Aucune autre partie de l'application n'a besoin d'être modifiée : le
 * moteur de débat, l'API route et l'UI ne dépendent que de `ProviderId` et
 * de l'interface `AIProvider`.
 */
class ProviderFactory {
  private registry: Record<ProviderId, AIProvider>;

  constructor() {
    this.registry = {
      anthropic: new AnthropicProvider(),
      google: new GoogleProvider(),
      openai: new OpenAIProvider(),
      // Toujours disponible : permet de faire tourner l'app sans aucune clé API.
      demo: new DemoProvider(),
    };
  }

  get(providerId: ProviderId): AIProvider {
    const provider = this.registry[providerId];
    if (!provider) {
      throw new Error(`Provider inconnu: "${providerId}".`);
    }
    return provider;
  }

  isConfigured(providerId: ProviderId): boolean {
    return this.get(providerId).isConfigured();
  }

  getConfiguredProviders(): ProviderId[] {
    return (Object.keys(this.registry) as ProviderId[]).filter((id) =>
      this.registry[id].isConfigured()
    );
  }
}

// Singleton : les clients SDK sont réutilisés entre les requêtes (côté serveur).
export const providerFactory = new ProviderFactory();
