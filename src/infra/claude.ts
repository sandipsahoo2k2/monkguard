import { ModelClassifier } from '../domain/ports.js';

const PROMPT = (title: string, channel: string): string =>
  `A focus tool needs to know whether a video is educational `
  + `(school subjects, science, history, languages, skills, documentaries, how things work) `
  + `or entertainment (gaming, pranks, vlogs, memes, music, reactions, sports highlights).\n\n`
  + `Title: ${title}\nChannel: ${channel}\n\n`
  + `Answer with exactly one word: educational or entertainment.`;

/**
 * The optional last resort for titles the word lists cannot separate. The whole
 * product works without it: with no API key this class is never constructed,
 * nothing leaves the Mac, and the word lists have the final say.
 */
export class ClaudeClassifier implements ModelClassifier {
  constructor(private readonly apiKey: string, private readonly model = 'claude-haiku-5-5') {}

  async isEducational(title: string, channel: string): Promise<boolean | null> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: this.model,
          max_tokens: 8,
          messages: [{ role: 'user', content: PROMPT(title, channel) }],
        }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { content?: { text?: string }[] };
      const answer = (body.content?.[0]?.text ?? '').toLowerCase();
      if (answer.includes('educational')) return true;
      if (answer.includes('entertainment')) return false;
      return null;
    } catch {
      return null;
    }
  }
}
