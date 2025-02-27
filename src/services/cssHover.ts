/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nodes from '../parser/cssNodes';
import * as languageFacts from '../languageFacts/facts';
import { TextDocument, Range, Position, Hover, MarkedString, MarkupContent, MarkupKind } from 'vscode-languageserver-types';
import { selectorToMarkedString, simpleSelectorToMarkedString } from './selectorPrinting';
import { startsWith } from '../utils/strings';
import { ClientCapabilities } from '../cssLanguageTypes';
import { isDefined } from '../utils/objects';
import { isArray } from 'util';

export class CSSHover {
	private supportsMarkdown: boolean | undefined;

	constructor(private clientCapabilities: ClientCapabilities) {}

	public doHover(document: TextDocument, position: Position, stylesheet: nodes.Stylesheet): Hover {
		function getRange(node: nodes.Node) {
			return Range.create(document.positionAt(node.offset), document.positionAt(node.end));
		}

		const offset = document.offsetAt(position);
		const nodepath = nodes.getNodePath(stylesheet, offset);

		/**
		 * nodepath is top-down
		 * Build up the hover by appending inner node's information
		 */
		let hover: Hover = null;

		for (let i = 0; i < nodepath.length; i++) {
			const node = nodepath[i];

			if (node instanceof nodes.Selector) {
				hover = {
					contents: selectorToMarkedString(<nodes.Selector>node),
					range: getRange(node)
				};
				continue;
			}

			if (node instanceof nodes.SimpleSelector) {
				/**
				 * Some sass specific at rules such as `@at-root` are parsed as `SimpleSelector`
				 */
				if (!startsWith(node.getText(), '@')) {
					hover = {
						contents: simpleSelectorToMarkedString(<nodes.SimpleSelector>node),
						range: getRange(node)
					};
				}
				continue;
			}

			if (node instanceof nodes.Declaration) {
				const propertyName = node.getFullPropertyName();
				const entry = languageFacts.cssDataManager.getProperty(propertyName);
				if (entry) {
					if (typeof entry.description !== 'string') {
						hover = {
							contents: entry.description,
							range: getRange(node)
						};
					} else {
						const contents: MarkedString[] = [];
						if (entry.description) {
							contents.push(MarkedString.fromPlainText(entry.description));
						}
						const browserLabel = languageFacts.getBrowserLabel(entry.browsers);
						if (browserLabel) {
							contents.push(MarkedString.fromPlainText(browserLabel));
						}
						if (contents.length) {
							hover = {
								contents: contents,
								range: getRange(node)
							};
						}
					}
				}
				continue;
			}

			if (node instanceof nodes.UnknownAtRule) {
				const atRuleName = node.getText();
				const entry = languageFacts.cssDataManager.getAtDirective(atRuleName);
				if (entry) {
					hover = {
						contents: entry.description,
						range: getRange(node)
					};
				}
				continue;
			}

			if (node instanceof nodes.Node && node.type === nodes.NodeType.PseudoSelector) {
				const selectorName = node.getText();
				const entry =
					selectorName.slice(0, 2) === '::'
						? languageFacts.cssDataManager.getPseudoElement(selectorName)
						: languageFacts.cssDataManager.getPseudoClass(selectorName);
				if (entry) {
					hover = {
						contents: entry.description,
						range: getRange(node)
					};
				}
				continue;
			}
		}

		
		if (hover) {
			hover.contents = this.convertContents(hover.contents);
		}

		return hover;
	}

	private convertContents(contents: MarkupContent | MarkedString | MarkedString[]): MarkupContent | MarkedString | MarkedString[] {
		if (!this.doesSupportMarkdown()) {
			if (typeof contents === 'string') {
				return contents;
			}
			// MarkupContent
			else if ('kind' in contents) {
				return {
					kind: 'plaintext',
					value: contents.value
				};
			}
			// MarkedString[]
			else if (isArray(contents)) {
				return contents.map(c => {
					return typeof c === 'string' ? c : c.value;
				});
			}
			// MarkedString
			else {
				return contents.value;
			}
		}

		return contents;
	}

	private doesSupportMarkdown() {
		if (!isDefined(this.supportsMarkdown)) {
			if (!isDefined(this.clientCapabilities)) {
				this.supportsMarkdown = true;
				return this.supportsMarkdown;
			}

			const hover = this.clientCapabilities.textDocument && this.clientCapabilities.textDocument.hover;
			this.supportsMarkdown = hover && hover.contentFormat && Array.isArray(hover.contentFormat) && hover.contentFormat.indexOf(MarkupKind.Markdown) !== -1;
		}
		return this.supportsMarkdown;
	}
}
