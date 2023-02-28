import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Scope,
	Setting,
	WorkspaceLeaf,
} from 'obsidian';

import { around, dedupe } from 'monkey-around';

interface VimScrollSetting {
	scrollDifference: number;
}

declare module 'obsidian' {
	interface App {
		commands: {
			executeCommandById(id: string): void;
			executeCommand(args: any[]): void;
		};
	}
}

const DEFAULT_SETTINGS: VimScrollSetting = { scrollDifference: 4 };

const registerScopes = (scope: Scope, plugin: VimReadingViewNavigation) => {
	const self = plugin;
	// Scroll down
	scope.register([], 'j', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		self.keyArray = self.resetJumpTop();
		if (leaf.getMode() === 'preview') {
			self.scrollDown(leaf);
		}
		return true;
	});

	// Scroll up
	scope.register([], 'k', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		self.keyArray = self.resetJumpTop();
		if (leaf.getMode() === 'preview') {
			self.scrollUp(leaf);
		}
		return true;
	});
	scope.register([], 'g', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf.getMode() === 'preview' && evt.key === 'g') {
			if (self.keyArray.length === 0) {
				addEventListener('keydown', self.jumpTopEvent);
				self.keyArray.push(evt.key);
				return false;
			}
		}
		return true;
	});

	// Jump to bottom
	//  1st evt registers g when CapsLock is on
	//  2nd evt registers Shift+g
	scope.register([], 'g', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		if (leaf.getMode() === 'preview' && evt.key === 'G') {
			self.keyArray = self.resetJumpTop();
			self.jumpBottom(leaf);
		}
		return true;
	});
	scope.register(['Shift'], 'g', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		self.keyArray = self.resetJumpTop();
		if (leaf.getMode() === 'preview') {
			self.jumpBottom(leaf);
		}
		return true;
	});

    /* jump up by a page */
	scope.register([Shift], 'k', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		self.keyArray = self.resetJumpTop();
		if (leaf.getMode() === 'preview') {
			self.pageUp(leaf);
		}
		return true;
	});

    /* jump down by a page */
	scope.register(['Shift'], 'j', (evt: KeyboardEvent) => {
		const leaf = app.workspace.getActiveViewOfType(MarkdownView);
		self.keyArray = self.resetJumpTop();
		if (leaf.getMode() === 'preview') {
			self.pageDown(leaf);
		}
		return true;
	});


};

export default class VimReadingViewNavigation extends Plugin {
	settings: VimScrollSetting;
	navScope: Scope;
	jumpTopEvent: (event: KeyboardEvent) => void;
	keyArray: string[] = [];
	uninstall: any[] = [];
	leaf: WorkspaceLeaf | null = null;
	ids: Set<string> = new Set();
	listener: EventListener;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new VimScrollSettingTab(this.app, this));

		// Jump to top
		this.jumpTopEvent = (event: KeyboardEvent) => {
			if (event.key != 'g') {
				this.keyArray = this.resetJumpTop();
			} else {
				const leaf = app.workspace.getActiveViewOfType(MarkdownView);
				this.doScroll(leaf, 0);
				this.keyArray = this.resetJumpTop();
			}
		};

		const navScope = (this.navScope = new Scope(app.scope));
		registerScopes(this.navScope, this);

		const plugin = this;
		// in case reading/edit mode got toggled without closing the search/replace
		this.registerEvent(
			app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf.view.getViewType() === 'markdown') {
					plugin.leaf = leaf;
					// @ts-expect-error, not typed
					if (this.ids.has(leaf.id)) return;
					// @ts-expect-error, not typed
					this.ids.add(leaf.id);
					// @ts-expect-error, not typed
					if (!leaf.view.scope) {
						leaf.view.scope = navScope;
					}

					this.uninstall.push(
						// @ts-expect-error, not typed
						around(leaf.view.previewMode.search, {
							hide(oldMethod) {
								return function (...args) {
									const result =
										oldMethod &&
										oldMethod.apply(this, args);
									// @ts-expect-error, not typed
									leaf.view.scope = navScope;
									// otherwise listener wouldn't get removed when button is clicked
									leaf.view.containerEl.removeEventListener(
										'keydown',
										listener,
										{ capture: false }
									);
									return result;
								};
							},
						})
					);

					// somehow Escape doesn't trigger the monkey-patched hide method, only
					// clicking the close button does that
					this.uninstall.push(
						around(leaf.view, {
							// @ts-expect-error, not typed
							showSearch(oldMethod) {
								return function (...args) {
									const result =
										oldMethod &&
										oldMethod.apply(this, args);
									plugin.leaf.view.containerEl.addEventListener(
										'keydown',
										listener,
										{ capture: false }
									);
									return result;
								};
							},
						})
					);
				}
			})
		);

		const listener = (this.listener = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				this.leaf.view.scope = navScope;
				this.leaf.view.containerEl.removeEventListener(
					'keydown',
					listener,
					{ capture: false }
				);
			}
		});

		console.log('Vim Reading View Navigation loaded.');
	}

	async onunload() {
		removeEventListener('keydown', this.jumpTopEvent);
		for (const el of this.uninstall) {
			el();
		}
		app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
			if (leaf.view.getViewType() === 'markdown') {
				if (leaf.view.scope === this.navScope) {
					leaf.view.scope = null;
					leaf.view.containerEl.removeEventListener(
						'keydown',
						this.listener,
						{ capture: false }
					);
				}
			}
		});
		console.log('Vim Reading View Navigation unloaded.');
	}

	resetJumpTop(): string[] {
		removeEventListener('keydown', this.jumpTopEvent);
		return [];
	}

	getScroll(leaf: MarkdownView): number {
		return leaf.previewMode.getScroll();
	}

	scrollDown(leaf: MarkdownView) {
		const scroll = this.getScroll(leaf);
		const num = scroll + this.settings.scrollDifference;
		this.doScroll(leaf, num);
	}

	scrollUp(leaf: MarkdownView) {
		const scroll = this.getScroll(leaf);
		const num = scroll - this.settings.scrollDifference;
		this.doScroll(leaf, num);
	}
    pageDown(leaf: MarkdownView) {
        const scroll = this.getScroll(leaf);
        const num = scroll + 15;
        this.doScroll(leaf, num);
    }

    pageUp(leaf: MarkdownView) {
        const scroll = this.getScroll(leaf);
        const num = scroll - 15;
        this.doScroll(leaf, num);
    }
	jumpBottom(leaf: MarkdownView) {
		let scroll = this.getScroll(leaf);
		this.doScroll(leaf, scroll + 5);
		let newScroll = this.getScroll(leaf);

		while (newScroll != scroll) {
			scroll = newScroll;
			this.doScroll(leaf, scroll + 5);
			newScroll = this.getScroll(leaf);
		}
	}

	doScroll(leaf: MarkdownView, num: number) {
		leaf.setEphemeralState({ scroll: num });
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VimScrollSettingTab extends PluginSettingTab {
	plugin: VimReadingViewNavigation;

	constructor(app: App, plugin: VimReadingViewNavigation) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { settings } = this.plugin;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Vim Reading View Navigation' });

		new Setting(containerEl)
			.setName('Scroll amount')
			.setDesc('It must be greater than 0.')
			.addText((text) => {
				text.setPlaceholder('Enter a number greater than 0. Default: 1')
					.setValue(settings.scrollDifference.toString())
					.onChange(async (value) => {
						const num = Number.parseInt(value);
						if (Number.isInteger(num) && num > 0) {
							settings.scrollDifference = num;
							await this.plugin.saveSettings();
						} else {
							new Notice(
								'Please enter an integer greater than 0.'
							);
						}
					});
			});
	}
}
