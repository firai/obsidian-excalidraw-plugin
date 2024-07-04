
import { MAX_IMAGE_SIZE, IMAGE_TYPES, ANIMATED_IMAGE_TYPES, MD_EX_SECTIONS } from "src/constants/constants";
import { App, TFile, WorkspaceLeaf } from "obsidian";
import { ExcalidrawAutomate } from "src/ExcalidrawAutomate";
import { REGEX_LINK, REG_LINKINDEX_HYPERLINK, getExcalidrawMarkdownHeaderSection } from "src/ExcalidrawData";
import ExcalidrawView from "src/ExcalidrawView";
import { ExcalidrawElement, ExcalidrawFrameElement } from "@zsviczian/excalidraw/types/excalidraw/element/types";
import { getLinkParts } from "./Utils";
import { cleanSectionHeading } from "./ObsidianUtils";
import { getEA } from "src";
import { ExcalidrawImperativeAPI } from "@zsviczian/excalidraw/types/excalidraw/types";
import { EmbeddableMDCustomProps } from "src/dialogs/EmbeddableSettings";
import { nanoid } from "nanoid";

export const insertImageToView = async (
  ea: ExcalidrawAutomate,
  position: { x: number, y: number },
  file: TFile | string,
  scale?: boolean,
):Promise<string> => {
  ea.clear();
  ea.style.strokeColor = "transparent";
  ea.style.backgroundColor = "transparent";
  const api = ea.getExcalidrawAPI();
  ea.canvas.theme = api.getAppState().theme;
  const id = await ea.addImage(
    position.x,
    position.y,
    file,
    scale,
  );
  await ea.addElementsToView(false, true, true);
  return id;
}

export const insertEmbeddableToView = async (
  ea: ExcalidrawAutomate,
  position: { x: number, y: number },
  file?: TFile,
  link?: string,
):Promise<string> => {
  ea.clear();
  ea.style.strokeColor = "transparent";
  ea.style.backgroundColor = "transparent";
  if(file && (IMAGE_TYPES.contains(file.extension) || ea.isExcalidrawFile(file)) && !ANIMATED_IMAGE_TYPES.contains(file.extension)) {
    return await insertImageToView(ea, position, file);
  } else {
    const id = ea.addEmbeddable(
      position.x,
      position.y,
      MAX_IMAGE_SIZE,
      MAX_IMAGE_SIZE,
      link,
      file,
    );
    await ea.addElementsToView(false, true, true);
    return id;
  }
}

export const getLinkTextFromLink = (text: string): string => {
  if (!text) return;
  if (text.match(REG_LINKINDEX_HYPERLINK)) return;

  const parts = REGEX_LINK.getRes(text).next();
  if (!parts.value) return;

  const linktext = REGEX_LINK.getLink(parts); //parts.value[2] ? parts.value[2]:parts.value[6];
  if (linktext.match(REG_LINKINDEX_HYPERLINK)) return;

  return linktext;
}

export const openTagSearch = (link:string, app: App, view?: ExcalidrawView) => {
  const tags = link
    .matchAll(/#([\p{Letter}\p{Emoji_Presentation}\p{Number}\/_-]+)/gu)
    .next();
  if (!tags.value || tags.value.length < 2) {
    return;
  }
  const search = app.workspace.getLeavesOfType("search");
  if (search.length == 0) {
    return;
  }
  //@ts-ignore
  search[0].view.setQuery(`tag:${tags.value[1]}`);
  app.workspace.revealLeaf(search[0]);

  if (view && view.isFullscreen()) {
    view.exitFullscreen();
  }
  return;
}

export const openExternalLink = (link:string, app: App, element?: ExcalidrawElement):boolean => {
  if (link.match(/^cmd:\/\/.*/)) {
    const cmd = link.replace("cmd://", "");
    //@ts-ignore
    app.commands.executeCommandById(cmd);
    return true;
  }
  if (link.match(REG_LINKINDEX_HYPERLINK)) {
      window.open(link, "_blank");
    return true;
  }
  return false;
}

export const getExcalidrawFileForwardLinks = (app: App, excalidrawFile: TFile, secondOrderLinksSet: Set<string>):string => {
  let secondOrderLinks = "";
  const forwardLinks = app.metadataCache.getLinks()[excalidrawFile.path];
  if(forwardLinks && forwardLinks.length > 0) {
    const linkset = new Set<string>();
    forwardLinks.forEach(link => {
      const linkparts = getLinkParts(link.link);
      const f = app.metadataCache.getFirstLinkpathDest(linkparts.path, excalidrawFile.path);
      if(f && f.path !== excalidrawFile.path) {
        if(secondOrderLinksSet.has(f.path)) return;
        secondOrderLinksSet.add(f.path);
        linkset.add(`[[${f.path}${linkparts.ref?"#"+linkparts.ref:""}|Second Order Link: ${f.basename}]]`);
      }
    });
    secondOrderLinks = [...linkset].join(" ");             
  }
  return secondOrderLinks;
}

export const getFrameBasedOnFrameNameOrId = (frameName: string, elements: ExcalidrawElement[]): ExcalidrawFrameElement | null => {
  const frames = elements
    .filter((el: ExcalidrawElement)=>el.type==="frame")
    .map((el: ExcalidrawFrameElement, idx: number)=>{
      return {el: el, id: el.id, name: el.name ?? `Frame ${String(idx+1).padStart(2,"0")}`};
    })
    .filter((item:any) => item.id === frameName || item.name === frameName)
    .map((item:any)=>item.el as ExcalidrawFrameElement);
  return frames.length === 1 ? frames[0] : null;
}

export const addBackOfTheNoteCard = async (view: ExcalidrawView, title: string, activate: boolean = true, cardBody?: string, embeddableCustomData?: EmbeddableMDCustomProps):Promise<string> => {
  const data = view.data;
  const header = getExcalidrawMarkdownHeaderSection(data);
  const body = data.split(header)[1];
  const shouldAddHashtag = body && body.startsWith("%%");
  const hastag = header.match(/#\n+$/m);
  const shouldRemoveTrailingHashtag = Boolean(hastag);
  view.data = data.replace(
    header,
    (shouldRemoveTrailingHashtag 
      ? header.substring(0,header.length-hastag[0].length) 
      : header) +
        `\n# ${title}\n\n${cardBody ? cardBody+"\n\n" : ""}${
          shouldAddHashtag || shouldRemoveTrailingHashtag ? "#\n" : ""}`);
  
  await view.forceSave(true);
  let watchdog = 0;
  await sleep(200);
  let found:string;
  while (watchdog++ < 10 && !(found=(await view.app.metadataCache.blockCache
    .getForFile({ isCancelled: () => false },view.file))
    .blocks.filter((b: any) => b.display && b.node?.type === "heading")
    .filter((b: any) => !MD_EX_SECTIONS.includes(b.display))
    .map((b: any) => cleanSectionHeading(b.display))
    .find((b: any) => b === title))) {
      await sleep(200);
  }

  const ea = getEA(view) as ExcalidrawAutomate;
  const id = ea.addEmbeddable(
    0,0,400,500,
    `[[${view.file.path}#${title}]]`,
    undefined,
    embeddableCustomData
  );
  await ea.addElementsToView(true, false, true);

  const api = view.excalidrawAPI as ExcalidrawImperativeAPI;
  const el = ea.getViewElements().find(el=>el.id === id);
  api.selectElements([el]);
  if(activate) {
    setTimeout(()=>{
      api.updateScene({appState: {activeEmbeddable: {element: el, state: "active"}}});
      if(found) view.getEmbeddableLeafElementById(el.id)?.editNode?.();
    });
  }
  ea.destroy();
  return el.id;
}

export const renderContextMenuAction = (React: any, label: string, action: Function, onClose: (callback?: () => void) => void) => {
  return React.createElement (
    "li",          
    {
      key: nanoid(),
      onClick: () => {
        onClose(()=>action())
      },
    },
    React.createElement(
      "button",
      {              
        className: "context-menu-item",
      },
      React.createElement(
        "div",
        {
          className: "context-menu-item__label",
        },
        label,
      ),
      React.createElement(
        "kbd",
        {
          className: "context-menu-item__shortcut",
        },
        "", //this is where the shortcut may go in the future
      ),
    )
  );
}

export const tmpBruteForceCleanup = (view: ExcalidrawView) => {
  window.setTimeout(()=>{
    if(!view) return;
    // const cleanupHTMLElement = (el: Element) => {
    //   //console.log(el);
    //   while(el.firstElementChild) {
    //     cleanupHTMLElement(el.firstElementChild);
    //     el.removeChild(el.firstElementChild);
    //   }
    //   Object.keys(el).forEach((key) => {
    //     //@ts-ignore
    //     delete el[key];
    //   });
    //   el.empty();
    // }

    // const cleanupLeaf = (l:any) => {
    //   l.detach?.();
    //   l.resizeObserver?.disconnect?.();
    //   l.view?.unload?.();
    //   l.component?.unload?.();      
    //   Object.keys(l).forEach((key) => {
    //     const obj = l[key];
    //     if (obj instanceof Element) {
    //       // Recursively empty the DOM element's children
    //       while (obj.firstChild) {
    //         cleanupHTMLElement(obj.firstElementChild);
    //         obj.removeChild(obj.firstElementChild);
    //       }
    //       obj.empty();
    //       delete l[key];
    //       return;
    //     }
    //     //@ts-ignore
    //     delete l[key];
    //   });
    // }

    // //@ts-ignore
    // if(view.leaf && !view.leaf.parent) {
    //   if(view.containerEl) {
    //     cleanupHTMLElement(view.containerEl);
    //   }
    //   const leaves = new Set();
    //   leaves.add(view.leaf);
    //   while(leaves.has(view.leaf.getContainer())) { 
    //     leaves.add(view.leaf.getContainer());
    //   }
    //   const roots = new Set();
    //   roots.add(view.leaf.getRoot());
    //   leaves.forEach((leaf:WorkspaceLeaf) => {
    //     roots.add(leaf.getRoot());
    //   });
    //   leaves.forEach((l:any) => cleanupLeaf(l));
    //   leaves.clear();
    //   roots.forEach((root:any) => cleanupLeaf(root));
    //   roots.clear();
    // }

    Object.keys(view).forEach((key) => {
      //@ts-ignore    
      delete view[key];
    });
  }, 500);
}