import * as TypeMoq from 'typemoq'
import * as wrappers from '../wrappers'
import * as vscode from 'vscode'
import * as packages from '../packages'
import { basename } from 'path'
import * as context from '../context'
import * as autoproj from '../autoproj'
import * as async from '../async'
import * as debug from '../debug'

export class VSCode
{
    mock: TypeMoq.IMock<wrappers.VSCode>;
    mockActiveEditor: TypeMoq.IMock<vscode.TextEditor>;

    workspaceFolders: vscode.WorkspaceFolder[];
    private _activeEditor: vscode.TextEditor;
    constructor()
    {
        this.mock = TypeMoq.Mock.ofType<wrappers.VSCode>();

        this.mock.setup(x => x.workspaceFolders).
            returns(() => this.workspaceFolders);

        this.mockActiveEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();

        this.mock.setup(x => x.activeTextEditor).
            returns(() => this.editor());
    }

    private editor(): vscode.TextEditor
    {
        return this._activeEditor;
    }

    addWorkspaceConfiguration(section: string, path?: string): TypeMoq.IMock<vscode.WorkspaceConfiguration>
    {
        let mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        if (path)
        {
            let resource = vscode.Uri.file(path);
            this.mock.setup(x => x.getConfiguration(section, resource))
                .returns(() => mockWorkspaceConf.object);
        } else
        {
            this.mock.setup(x => x.getConfiguration(section))
                .returns(() => mockWorkspaceConf.object);
        }
        return mockWorkspaceConf;
    }

    addConfigurationValue<T>(mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>,
        section: string, value: T): void
    {
        mockWorkspaceConf.setup(x => x.get(section))
            .returns(() => value);
    }

    addCodeWorkspaceFolder(path: string): vscode.WorkspaceFolder
    {
        if (!this.workspaceFolders)
            this.workspaceFolders = new Array<vscode.WorkspaceFolder>();

        let folder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(path),
            name: basename(path),
            index: this.workspaceFolders.length
        };
        this.addResourceToFolder(path, folder);
        this.workspaceFolders.push(folder);
        return folder;
    }

    addResourceToFolder(path: string, folder: vscode.WorkspaceFolder): void
    {
        let resource = vscode.Uri.file(path);        
        this.mock.setup(x => x.getWorkspaceFolder(resource)).
            returns(() => folder);
    }

    openEditor(path: string)
    {
        let resource = vscode.Uri.parse(path);
        let mockDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();

        mockDocument.setup(x => x.uri).returns(() => resource);
        this.mockActiveEditor.setup(x => x.document).returns(() => mockDocument.object);
        this._activeEditor = this.mockActiveEditor.object;
    }

    closeEditor(): void
    {
        this._activeEditor = undefined;
    }
}

export class Context
{
    mock: TypeMoq.IMock<context.Context>;
    constructor()
    {
        this.mock = TypeMoq.Mock.ofType<context.Context>();
    }
    set workspaces(workspaces: autoproj.Workspaces)
    {
        this.mock.setup(x => x.workspaces).returns(() => workspaces);
    }
    set vscode(vscode: wrappers.VSCode)
    {
        this.mock.setup(x => x.vscode).returns(() => vscode);
    }
    set bridge(bridge: async.EnvironmentBridge)
    {
        this.mock.setup(x => x.bridge).returns(() => bridge);
    }
    setDebuggingTarget(path: string, target: debug.Target)
    {
        this.mock.setup(x => x.getDebuggingTarget(path)).
            returns(() => target);
    }
    setSelectedPackage(path?: string, type?: packages.Type): TypeMoq.IMock<packages.Package>
    {
        let mockPkg: TypeMoq.IMock<packages.Package>;
        if (path)
        {
            mockPkg = TypeMoq.Mock.ofType<packages.Package>();
            mockPkg.setup((x: any) => x.then).returns(() => undefined);
            mockPkg.setup(x => x.path).returns(() => path);
            mockPkg.setup(x => x.type).returns(() => type);
            mockPkg.setup(x => x.name).returns(() => basename(path));
        }
        else
        {
            let pkg = new packages.InvalidPackage();
            mockPkg = TypeMoq.Mock.ofInstance<packages.InvalidPackage>(pkg);
        }
        this.mock.setup(x => x.getSelectedPackage()).
            returns(() => Promise.resolve(mockPkg.object));
        return mockPkg;
    }
    setPackageType(path: string, type: string)
    {
        let pkgType;

        if (type) pkgType = packages.Type.fromName(type);
        this.mock.setup(x => x.getPackageType(path)).returns(() => pkgType);
    }
    setDebuggingConfigurationForPkg(path: string, config: context.RockDebugConfig)
    {
        this.mock.setup(x => x.debugConfig(path)).returns(() => config);
    }
}

export class AutoprojWorkspaces
{
    mock: TypeMoq.IMock<autoproj.Workspaces>;
    folderToWorkspace: Map<string, autoproj.Workspace>;
    constructor()
    {
        this.mock = TypeMoq.Mock.ofType<autoproj.Workspaces>();
        this.folderToWorkspace = new Map<string, autoproj.Workspace>();
        this.mock.setup(x => x.folderToWorkspace).
            returns(() => this.folderToWorkspace);
    }
    addFolder(path: string, root: string): TypeMoq.IMock<autoproj.Workspace>
    {
        let ws = TypeMoq.Mock.ofType<autoproj.Workspace>();
        ws.setup(x => x.root).returns(() => root);
        this.folderToWorkspace.set(path, ws.object);
        return ws;
    }
    defineAsConfig(path: string, isConfig: boolean)
    {
        this.mock.setup(x => x.isConfig(path)).returns(() => isConfig);
    }
    rejectInfoPromise(ws: TypeMoq.IMock<autoproj.Workspace>, reason?: any)
    {
        ws.setup(x => x.info()).returns(() => Promise.reject(reason));
    }
    resolveInfoPromise(ws: TypeMoq.IMock<autoproj.Workspace>, path: string)
    {
        let wsInfo = {
            path: path,
            packages: new Map<string, autoproj.Package>(),
            packageSets: new Map<string, autoproj.PackageSet>()
        }
        ws.setup(x => x.info()).returns(() => Promise.resolve(wsInfo));        
        return wsInfo;
    }
    async setPackageType(name: string, type: string, ws: TypeMoq.IMock<autoproj.Workspace>)
    {
        let mockPackage = TypeMoq.Mock.ofType<autoproj.Package>();
        let wsInfo = await ws.object.info();
        wsInfo.packages.set(name, mockPackage.object);
        mockPackage.setup(x => x.type).returns(() => type);
    }
}