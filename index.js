import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../popup.js';

// Default settings
const defaultSettings = {
    enabled: true,
    folders: [],
    folderModels: {},
    modelUsage: {},
};

const modelSelectors = [
    // Text Generation APIs
    '#generic_model_textgenerationwebui',
    '#custom_model_textgenerationwebui',
    '#model_togetherai_select',
    '#openrouter_model',
    '#model_infermaticai_select',
    '#model_dreamgen_select',
    '#mancer_model',
    '#vllm_model',
    '#aphrodite_model',
    '#ollama_model',
    '#tabby_model',
    '#llamacpp_model',

    // Chat Completion APIs
    '#model_openai_select',
    '#model_claude_select',
    '#model_openrouter_select',
    '#model_ai21_select',
    '#model_google_select',
    '#model_vertexai_select',
    '#model_mistralai_select',
    '#model_custom_select',
    '#model_cohere_select',
    '#model_perplexity_select',
    '#model_groq_select',
    '#model_chutes_select',
    '#model_siliconflow_select',
    '#model_electronhub_select',
    '#model_nanogpt_select',
    '#model_deepseek_select',
    '#model_aimlapi_select',
    '#model_xai_select',
    '#model_pollinations_select',
    '#model_moonshot_select',
    '#model_fireworks_select',
    '#model_cometapi_select',
    '#model_zai_select',
    '#azure_openai_model',

    // Other APIs
    '#horde_model',
    '#model_novel_select',
    '#sd_model',
];

let observer = null;
let selectedFolder = null;
let contextMenuFolder = null;

async function initModelViewer() {
    // Load settings
    if (!extension_settings.modelViewer) {
        extension_settings.modelViewer = {};
    }
    // Safe merge: Apply defaults only where keys are missing to preserve user settings
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings.modelViewer[key] === undefined) {
            extension_settings.modelViewer[key] = value;
        }
    }

    // Initial injection
    injectBoxes();

    // Start observer if enabled
    if (extension_settings.modelViewer.enabled) {
        startObserver();
    }
}

function startObserver() {
    if (observer) return;

    // We observe the main areas where model dropdowns are likely to appear or change visibility
    const targetNode = document.getElementById('settings') || document.body;

    observer = new MutationObserver((mutations) => {
        let shouldInject = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                shouldInject = true;
                break;
            }
            if (mutation.type === 'attributes' && (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                // If visibility might have changed
                shouldInject = true;
                break;
            }
        }

        if (shouldInject) {
            injectBoxes();
        }
    });

    observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
    });
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function injectBoxes() {
    if (!extension_settings.modelViewer.enabled) return;

    modelSelectors.forEach(selector => {
        const target = $(selector);
        if (target.length === 0) return;

        // Skip if hidden
        if (target.is(':hidden')) {
            target.next('.model-viewer-box').remove();
            return;
        }

        // Check if already added to this specific target
        if (target.next('.model-viewer-box').length > 0) return;

        // Ensure the target is in a flex container for in-line placement
        const parent = target.parent();
        if (!parent.hasClass('flex-container')) {
            // Only wrap if it's not already in a flex container
            target.wrap('<div class="flex-container"></div>');
        }
        target.addClass('flex1');

        const viewerBox = $(`<div class="menu_button model-viewer-box fa-solid fa-eye fa-fw interactable" title="View models" data-target="${selector}" role="button" tabindex="0"></div>`);

        target.after(viewerBox);
        viewerBox.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showModelsDialog(selector);
        });
    });
}

function getModelsFromSelect(targetSelector) {
    const options = $(targetSelector + ' option');
    return options.map((i, el) => {
        return {
            value: $(el).val(),
            text: $(el).text(),
        };
    }).get().filter(m => m.value && m.value !== '' && !m.text.includes('--'));
}

function sortModelsAlphabetically(modelList) {
    return modelList.sort((a, b) => {
        return a.localeCompare(b, undefined, {
            numeric: true,
            sensitivity: 'base',
        });
    });
}

function incrementModelUsage(modelName) {
    const usages = extension_settings.modelViewer.modelUsage;
    usages[modelName] = (usages[modelName] || 0) + 1;
    saveSettingsDebounced();
}

async function showModelsDialog(targetSelector) {
    const modelsData = getModelsFromSelect(targetSelector);

    if (modelsData.length === 0) {
        toastr.info('No models available to show.');
        return;
    }

    // Map just names for easier processing, but keep reference for selection
    const models = modelsData.map(m => m.text);

    // Create the container structure
    const container = $('<div class="selector-container" style="border:none; max-width:100%;"></div>');
    const foldersWrapper = $('<div id="folders-wrapper" class="folders-wrapper"></div>');
    const addFolderBtn = $('<button id="add-folder-btn" class="add-folder-btn">+ Add Folder</button>');
    const modelsGrid = $('<div id="models-grid"></div>');

    // Context Menu (created once per popup show)
    const contextMenu = $(`
        <div id="folder-context-menu" class="context-menu hidden">
            <button class="context-menu-item" id="rename-btn">Rename</button>
            <button class="context-menu-item" id="delete-btn">Delete</button>
        </div>
    `);

    foldersWrapper.append(addFolderBtn);
    container.append(foldersWrapper);
    container.append(modelsGrid);
    container.append(contextMenu);

    // Helper to hide context menu
    const hideContextMenu = () => {
        contextMenu.addClass('hidden');
        contextMenuFolder = null;
    };

    // Helper to render everything
    const render = () => {
        renderFolders(foldersWrapper, addFolderBtn, render, renderModelsFunc, models);
        renderModelsFunc();
    };

    const renderModelsFunc = () => {
        renderModels(modelsGrid, models, modelsData, targetSelector, render, popup, hideContextMenu);
    };

    // Event handlers for context menu
    contextMenu.find('#rename-btn').on('click', (e) => {
        e.stopPropagation();
        renameFolder(render);
        hideContextMenu();
    });

    contextMenu.find('#delete-btn').on('click', (e) => {
        e.stopPropagation();
        deleteFolder(render);
        hideContextMenu();
    });

    // Close menus on click outside
    container.on('click', (e) => {
        if (!contextMenu.find(e.target).length && !$(e.target).closest('.folder-item').length) {
            hideContextMenu();
        }
        if (!$(e.target).closest('.model-card').length) {
            container.find('.folder-dropdown').addClass('hidden');
            container.find('.model-card').removeClass('active');
        }
    });

    addFolderBtn.on('click', () => {
        addFolder();
        render();
    });

    const popup = new Popup(container, POPUP_TYPE.TEXT, '', {
        wide: true,
        allowVerticalScrolling: true,
        okButton: 'Close',
    });

    // Initialize render
    render();

    const resizeHandler = () => {
        adjustFolderWidths(foldersWrapper, addFolderBtn);
    };
    window.addEventListener('resize', resizeHandler);

    // Cleanup on close


    await popup.show();

    window.removeEventListener('resize', resizeHandler);
    contextMenu.remove();
}

function renderFolders(wrapper, button, render, renderModelsFunc, allAvailableModels) {
    wrapper.find('.folder-item').remove();
    const folders = extension_settings.modelViewer.folders;
    const folderModels = extension_settings.modelViewer.folderModels;

    if (folders.length === 0) return;

    folders.forEach(folder => {
        const folderItem = $('<div class="folder-item"></div>');
        if (selectedFolder === folder) {
            folderItem.addClass('selected');
        }
        folderItem.css('cursor', 'pointer');

        const modelsInFolder = folderModels[folder] || [];
        const count = modelsInFolder.filter(m => allAvailableModels.includes(m)).length;
        if (count === 0) {
            folderItem.addClass('disabled');
        }

        folderItem.html(`
          <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="folder-name">${folder}</span>
          <span class="folder-count">(${count})</span>
        `);

        folderItem.on('click', (e) => {
            // Left click
            if (e.button !== 0 || folderItem.hasClass('disabled')) return;

            if (selectedFolder === folder) {
                selectedFolder = null;
            } else {
                selectedFolder = folder;
            }
            render();
        });

        folderItem.on('contextmenu', (e) => {
            e.preventDefault();
            contextMenuFolder = folder;
            const menu = $('#folder-context-menu');
            const container = menu.closest('.selector-container');
            const rect = container[0].getBoundingClientRect();

            // Calculate position relative to container
            menu.css({
                left: (e.clientX - rect.left) + 'px',
                top: (e.clientY - rect.top) + 'px',
            }).removeClass('hidden');
        });

        button.before(folderItem);
    });

    // Adjust logic (Flex grow)
    // using a timeout to ensure DOM is updated
    setTimeout(() => {
        adjustFolderWidths(wrapper, button);
    }, 0);
}

function adjustFolderWidths(wrapper, button) {
    if (!wrapper || !wrapper.length) return;

    // Convert jQuery objects to native elements for offsetTop calculations
    const $items = wrapper.find('.folder-item');
    const items = $items.toArray();
    const btnCtx = button[0];
    const allItems = [...items, btnCtx];

    if (allItems.length === 0) return;

    // Reset flex-grow
    allItems.forEach(item => {
        item.style.flexGrow = '0';
        item.style.flexBasis = 'auto';
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const wrapperEl = wrapper[0];
            const wrapperWidth = wrapperEl.offsetWidth;
            const gap = 8; // CSS gap value

            const rows = [];
            let currentRow = [];
            if (allItems.length === 0) return;

            let currentTop = allItems[0].offsetTop;

            allItems.forEach(item => {
                if (Math.abs(item.offsetTop - currentTop) > 1) { // Allow 1px tolerance
                    rows.push(currentRow);
                    currentRow = [item];
                    currentTop = item.offsetTop;
                } else {
                    currentRow.push(item);
                }
            });
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }

            // For each row, check if it's full before stretching
            rows.forEach(row => {
                // Calculate total width of items in this row
                let totalWidth = 0;
                row.forEach(item => {
                    totalWidth += item.offsetWidth;
                });
                // Add gaps between items
                totalWidth += (row.length - 1) * gap;

                // Calculate remaining space
                const remainingSpace = wrapperWidth - totalWidth;

                // Get average item width to see if another would fit
                const avgItemWidth = totalWidth / row.length;

                // Only stretch if there's not enough space for another item
                if (remainingSpace < avgItemWidth + gap) {
                    row.forEach(item => {
                        if (item === btnCtx) {
                            item.style.flexGrow = '0';
                        } else {
                            item.style.flexGrow = '1';
                        }
                    });
                }
            });
        });
    });
}

function renderModels(grid, allAvailableModels, modelsData, targetSelector, render, popup, hideContextMenu) {
    grid.empty();
    const folders = extension_settings.modelViewer.folders;
    const folderModels = extension_settings.modelViewer.folderModels;
    const currentSelectedValue = $(targetSelector).val();

    // Helper to select model
    const selectModel = (modelName) => {
        const modelObj = modelsData.find(m => m.text === modelName);
        if (modelObj) {
            incrementModelUsage(modelName);
            $(targetSelector).val(modelObj.value).trigger('change');
            popup.completeAffirmative();
        }
    };

    if (selectedFolder) {
        // Show Folder header
        grid.append(`<div class="unsorted-header">${selectedFolder}</div>`);

        const modelsGrid = $('<div class="models-grid"></div>');
        const modelsToShow = folderModels[selectedFolder] || [];

        // Filter to only show models that are actually available in the current dropdown
        const availableInFolder = modelsToShow.filter(m => allAvailableModels.includes(m));

        availableInFolder.forEach(model => {
            const card = $('<div class="model-card"></div>');
            const modelObj = modelsData.find(m => m.text === model);
            if (modelObj && modelObj.value === currentSelectedValue) {
                card.addClass('disabled');
            }
            card.html(`
                <div class="model-content">
                  <span class="model-name">${model}</span>
                  <button class="folder-btn">
                    <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                </div>
            `);

            card.on('click', (e) => {
                // Ignore if clicked on button or if disabled
                if ($(e.target).closest('.folder-btn').length || card.hasClass('disabled')) return;
                selectModel(model);
            });

            card.find('.folder-btn').on('click', (e) => {
                e.preventDefault();
                e.stopPropagation(); // Stop bubbling to card
                removeModelFromFolder(model, selectedFolder);
                render();
            });

            modelsGrid.append(card);
        });
        grid.append(modelsGrid);
    } else {
        // Unsorted Section
        const modelsInFolders = new Set();
        Object.values(folderModels).forEach(list => list.forEach(m => modelsInFolders.add(m)));
        const unsortedModels = allAvailableModels.filter(m => !modelsInFolders.has(m));

        if (unsortedModels.length > 0) {
            // Sort unsorted
            const sortedUnsorted = sortModelsAlphabetically([...unsortedModels]);

            grid.append('<div class="unsorted-header">to be sorted</div>');
            const unsortedGrid = $('<div class="models-grid"></div>');

            sortedUnsorted.forEach((model, idx) => {
                const card = $('<div class="model-card"></div>');
                const dropdownId = `dropdown-unsorted-${idx}`;
                card.html(`
                  <div class="model-content">
                    <span class="model-name" style="user-select: none;">${model}</span>
                  </div>
                  <div id="${dropdownId}" class="folder-dropdown hidden"></div>
                `);

                // Single click opens dropdown
                card.on('click', (e) => {
                    // Ignore clicks inside the dropdown
                    if ($(e.target).closest('.folder-dropdown').length) return;

                    e.stopPropagation();

                    const wasHidden = $(`#${dropdownId}`).hasClass('hidden');

                    // Close others
                    $('.folder-dropdown').addClass('hidden');
                    $('.model-card').removeClass('active');

                    if (wasHidden) {
                        $(`#${dropdownId}`).removeClass('hidden');
                        card.addClass('active');
                    }
                });

                // Populate Dropdown
                const dropdown = card.find(`#${dropdownId}`);
                if (folders.length > 0) {
                    folders.forEach(folder => {
                        const option = $(`<button class="folder-option">${folder}</button>`);
                        option.on('click', (e) => {
                            e.stopPropagation(); // Stop bubbling to card
                            addModelToFolder(model, folder);
                            dropdown.addClass('hidden');
                            render();
                        });
                        dropdown.append(option);
                    });
                } else {
                    dropdown.append('<div style="padding:8px; font-size:12px; color:var(--grey50)">No folders</div>');
                }

                unsortedGrid.append(card);
            });
            grid.append(unsortedGrid);
        }

        // All Section
        grid.append('<div class="unsorted-header">all</div>');
        const allGrid = $('<div class="models-grid"></div>');

        const sortedAll = sortModelsAlphabetically([...allAvailableModels]);

        sortedAll.forEach((model) => {
            const card = $('<div class="model-card"></div>');
            const modelObj = modelsData.find(m => m.text === model);
            if (modelObj && modelObj.value === currentSelectedValue) {
                card.addClass('disabled');
            }
            card.html(`
                <div class="model-content">
                  <span class="model-name" ${modelObj && modelObj.value === currentSelectedValue ? 'title="Model already selected"' : ''} style="user-select: none;">${model}</span>
                </div>
              `);

            // Click selects
            card.on('click', () => {
                if (card.hasClass('disabled')) return;
                selectModel(model);
            });
            allGrid.append(card);
        });
        grid.append(allGrid);
    }
}

function addFolder() {
    const folders = extension_settings.modelViewer.folders;
    let counter = folders.length + 1;
    let newFolder = `Folder ${counter}`;

    // Ensure uniqueness
    while (folders.includes(newFolder)) {
        counter++;
        newFolder = `Folder ${counter}`;
    }

    folders.push(newFolder);
    extension_settings.modelViewer.folderModels[newFolder] = [];
    saveSettingsDebounced();
}

function addModelToFolder(model, folder) {
    const list = extension_settings.modelViewer.folderModels[folder];
    if (!list.includes(model)) {
        list.push(model);
        saveSettingsDebounced();
    }
}

function removeModelFromFolder(model, folder) {
    const list = extension_settings.modelViewer.folderModels[folder];
    const index = list.indexOf(model);
    if (index > -1) {
        list.splice(index, 1);
        saveSettingsDebounced();
    }
}

function renameFolder(renderCallback) {
    if (!contextMenuFolder) return;

    // Find the folder element
    const folderLabel = $('.folder-name').filter((i, el) => $(el).text() === contextMenuFolder);
    if (folderLabel.length) {
        const currentName = contextMenuFolder;
        const input = $('<input type="text" style="width:100px; padding:2px; font-size:14px;">').val(currentName);

        input.on('click', e => e.stopPropagation());

        const finishRename = () => {
            const newName = String(input.val()).trim();
            const folders = extension_settings.modelViewer.folders;
            const folderModels = extension_settings.modelViewer.folderModels;

            if (newName && newName !== currentName && !folders.includes(newName)) {
                const index = folders.indexOf(currentName);
                if (index !== -1) {
                    folders[index] = newName;
                    folderModels[newName] = folderModels[currentName];
                    delete folderModels[currentName];

                    if (selectedFolder === currentName) {
                        selectedFolder = newName;
                    }
                    saveSettingsDebounced();
                }
            }
            renderCallback();
        };

        input.on('blur', finishRename);
        input.on('keydown', (e) => {
            if (e.key === 'Enter') finishRename();
            if (e.key === 'Escape') renderCallback();
        });

        folderLabel.replaceWith(input);
        input.focus().select();
    }
}

function deleteFolder(renderCallback) {
    if (!contextMenuFolder) return;

    const folders = extension_settings.modelViewer.folders;
    const folderModels = extension_settings.modelViewer.folderModels;

    const index = folders.indexOf(contextMenuFolder);
    if (index !== -1) {
        delete folderModels[contextMenuFolder];
        folders.splice(index, 1);

        if (selectedFolder === contextMenuFolder) {
            selectedFolder = null;
        }
        saveSettingsDebounced();
    }
    renderCallback();
}

eventSource.on(event_types.APP_READY, initModelViewer);
