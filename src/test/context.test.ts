'use strict';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as TypeMoq from 'typemoq';
import * as wrappers from '../wrappers';
import * as context from '../context';
import * as autoproj from '../autoproj';

describe("Context tests", function () {
    let subject: context.Context;
    let mockWrapper: TypeMoq.IMock<wrappers.VSCode>;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let workspaces: autoproj.Workspaces;

    beforeEach(function () {
        mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        workspaces = new autoproj.Workspaces;

        subject = new context.Context(mockContext.object,
            mockWrapper.object, workspaces);
    })

    it("returns the given vscode wrapper", function () {
        assert.strictEqual(mockWrapper.object, subject.vscode);
    });

    it("returns the given extension context", function () {
        assert.strictEqual(mockContext.object, subject.extensionContext);
    });

    it("returns the given workspaces", function () {
        assert.strictEqual(workspaces, subject.workspaces);
    });

    it("gets the package selection mode", function () {
        let mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;

        mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
        let selectionMode = subject.packageSelectionMode;
        mockWorkspaceConf.verify(x => x.get('packageSelectionMode'), TypeMoq.Times.once());
    });

    it("sets the selected package", function () {
        let mockWorkspaceState: TypeMoq.IMock<vscode.Memento>;
        mockWorkspaceState = TypeMoq.Mock.ofType<vscode.Memento>();

        let aPackage = { name: 'package', root: '/path/to/package' };
        mockContext.setup(x => x.workspaceState).returns(() => mockWorkspaceState.object);
        subject.selectedPackage = aPackage;
        mockWorkspaceState.verify(x => x.update('rockSelectedPackage', aPackage.root), TypeMoq.Times.once());
    });

    describe("get selectedPackage", function() {
        describe("on an empty workspace", function() {
            it("returns null if workspace is empty", function () {
                mockWrapper.setup(x => x.workspaceFolders).returns(() => undefined);
                assert.equal(subject.selectedPackage, null);
            });
        })

        describe("on a non-empty workspace", function() {
            let mockWorkspaceFolder1: TypeMoq.IMock<vscode.WorkspaceFolder>;
            let mockWorkspaceFolder2: TypeMoq.IMock<vscode.WorkspaceFolder>;
            let mockWorkspaceConf: TypeMoq.IMock<vscode.WorkspaceConfiguration>;
            
            beforeEach(function () {
                let workspaceFolders = new Array<vscode.WorkspaceFolder>();
                let uri1 = vscode.Uri.file('/etc/');
                let uri2 = vscode.Uri.file('/bin/');

                mockWorkspaceConf = TypeMoq.Mock.ofType<vscode.WorkspaceConfiguration>();                
                mockWorkspaceFolder1 = TypeMoq.Mock.ofType<vscode.WorkspaceFolder>();
                mockWorkspaceFolder2 = TypeMoq.Mock.ofType<vscode.WorkspaceFolder>();
                mockWorkspaceFolder1.setup(x => x.uri).returns(() => uri1);
                mockWorkspaceFolder2.setup(x => x.uri).returns(() => uri2);

                workspaceFolders.push(mockWorkspaceFolder1.object);
                workspaceFolders.push(mockWorkspaceFolder2.object);
                mockWrapper.setup(x => x.workspaceFolders).returns(() => workspaceFolders);                
            })

            describe("in manual package selection mode", function() {
                let mockWorkspaceState: TypeMoq.IMock<vscode.Memento>;
                beforeEach(function () {
                    mockWorkspaceState = TypeMoq.Mock.ofType<vscode.Memento>();
                    mockWorkspaceConf.setup(x => x.get('packageSelectionMode')).returns(() => 'manual');
                    mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
                    mockContext.setup(x => x.workspaceState).returns(() => mockWorkspaceState.object);
                })

                it("returns null if no package is selected", function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => null);
                    assert.equal(subject.selectedPackage, null);
                });

                it("returns null if the selected package no longer belongs to workspace", function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => '/usr/');
                    assert.equal(subject.selectedPackage, null);
                });

                it("returns the path and the name of the package", function () {
                    mockWorkspaceState.setup(x => x.get('rockSelectedPackage')).returns(() => '/etc/');
                    let rockPackage = subject.selectedPackage;
                    assert.equal(rockPackage.root, "/etc/");
                    assert.equal(rockPackage.name, "etc");
                });
            })

            describe("in auto package selection mode", function() {
                let mockTextEditor: TypeMoq.IMock<vscode.TextEditor>;
                let mockDocument: TypeMoq.IMock<vscode.TextDocument>;
                beforeEach(function () {
                    mockTextEditor = TypeMoq.Mock.ofType<vscode.TextEditor>();
                    mockDocument = TypeMoq.Mock.ofType<vscode.TextDocument>();

                    mockWorkspaceConf.setup(x => x.get('packageSelectionMode')).returns(() => 'auto');
                    mockWrapper.setup(x => x.getConfiguration('rock')).returns(() => mockWorkspaceConf.object);
                })

                it("returns null if no file is being edited", function () {
                    mockWrapper.setup(x => x.activeTextEditor).returns(() => undefined);                    
                    assert.equal(subject.selectedPackage, null);
                });

                it("returns null if the file's uri scheme is not 'file'", function () {
                    let fileUri = vscode.Uri.parse('ftp://ftp.foo.com/bar/');

                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    assert.equal(subject.selectedPackage, null);
                });

                it("returns null if the file does not belong to any package", function () {
                    let fileUri = vscode.Uri.file('/usr/bin/whoami');

                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    mockWrapper.setup(x => x.getWorkspaceFolder(fileUri)).returns(() => undefined);
                    assert.equal(subject.selectedPackage, null);                    
                });

                it("returns path and the name of the package that owns the file", function () {
                    let fileUri = vscode.Uri.file('/etc/passwd');
                    
                    mockWrapper.setup(x => x.activeTextEditor).returns(() => mockTextEditor.object);
                    mockTextEditor.setup(x => x.document).returns(() => mockDocument.object);
                    mockDocument.setup(x => x.uri).returns(() => fileUri);
                    mockWrapper.setup(x => x.getWorkspaceFolder(fileUri)).returns(() => mockWorkspaceFolder1.object);

                    let rockPackage = subject.selectedPackage;
                    assert.equal(rockPackage.root, "/etc/");
                    assert.equal(rockPackage.name, "etc");
                });
            })
        })
    })
});