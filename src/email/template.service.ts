import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Renders Handlebars email templates.
 *
 * HTML templates are compiled with Handlebars' default behaviour, so every
 * `{{variable}}` is HTML-escaped. Plain-text templates use a no-escape
 * instance because escaping must not leak entities into text parts.
 * Triple-stache is intentionally never used by the templates we ship, and
 * the layout's `{{{body}}}` only receives the already-escaped output above.
 */
@Injectable()
export class EmailTemplateService {
  private readonly htmlCache = new Map<string, Handlebars.TemplateDelegate>();
  private readonly textCache = new Map<string, Handlebars.TemplateDelegate>();
  private readonly textHandlebars = Handlebars.create();

  private readonly templatesDir = path.join(__dirname, 'templates');

  constructor() {
    this.textHandlebars.registerHelper('noop', () => '');
  }

  render(
    templateName: string,
    context: Record<string, unknown> = {},
  ): RenderedEmail {
    this.assertSafeTemplateName(templateName);

    const bodyHtml = this.renderFile(
      `${templateName}.html.hbs`,
      context,
      false,
    );
    const text = this.renderFile(`${templateName}.text.hbs`, context, true);

    const html = this.renderFile(
      'layout.html.hbs',
      { subject: context.subject ?? '', body: bodyHtml },
      false,
    );

    return { html, text };
  }

  private renderFile(
    fileName: string,
    context: Record<string, unknown>,
    asText: boolean,
  ): string {
    const cache = asText ? this.textCache : this.htmlCache;
    let compiled = cache.get(fileName);

    if (!compiled) {
      const fullPath = path.join(this.templatesDir, fileName);
      const source = fs.readFileSync(fullPath, 'utf8');
      compiled = asText
        ? this.textHandlebars.compile(source, { noEscape: true })
        : Handlebars.compile(source);
      cache.set(fileName, compiled);
    }

    return compiled(context);
  }

  private assertSafeTemplateName(name: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`Invalid email template name: ${name}`);
    }
  }
}
