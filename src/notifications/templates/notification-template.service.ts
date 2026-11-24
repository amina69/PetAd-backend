import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import {
  NOTIFICATION_TEMPLATES,
  NotificationTemplateDefinition,
} from './catalog';

export interface RenderedNotification {
  subject: string;
  message: string;
  route?: string;
}

@Injectable()
export class NotificationTemplateService {
  private readonly handlebars = Handlebars.create();
  private readonly cache = new Map<
    string,
    {
      subject: Handlebars.TemplateDelegate;
      message: Handlebars.TemplateDelegate;
      route?: Handlebars.TemplateDelegate;
    }
  >();

  private readonly catalog: Record<string, NotificationTemplateDefinition> =
    NOTIFICATION_TEMPLATES;

  render(
    templateName: string,
    context: Record<string, unknown> = {},
  ): RenderedNotification {
    const compiled = this.compile(templateName);
    return {
      subject: compiled.subject(context).trim(),
      message: compiled.message(context).trim(),
      route: compiled.route?.(context).trim(),
    };
  }

  private compile(templateName: string) {
    const cached = this.cache.get(templateName);
    if (cached) {
      return cached;
    }

    const definition = this.catalog[templateName];
    if (!definition) {
      throw new Error(`Unknown notification template: ${templateName}`);
    }

    // Notification subject/message are plain text. They are HTML-escaped
    // again by the email layer when inserted into an email template.
    const compiled = {
      subject: this.handlebars.compile(definition.subject, { noEscape: true }),
      message: this.handlebars.compile(definition.message, { noEscape: true }),
      route: definition.route
        ? this.handlebars.compile(definition.route, { noEscape: true })
        : undefined,
    };
    this.cache.set(templateName, compiled);
    return compiled;
  }
}
