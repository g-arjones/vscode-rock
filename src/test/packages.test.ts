'use strict'
import * as packages from '../packages'
import * as autoproj from '../autoproj'
import * as helpers from './helpers'
import * as vscode from 'vscode'
import * as assert from 'assert'
import * as TypeMoq from 'typemoq'
import * as context from '../context'
import * as tasks from '../tasks'
import * as status from '../status'
import * as wrappers from '../wrappers'
import * as debug from '../debug'
import * as async from '../async'
import { dirname, basename } from 'path'
import * as mocks from './mocks'

async function assertThrowsAsync(fn, msg?: RegExp)
{
    let f = () => {};
    try {
        await fn();
    }
    catch (e)
    {
        f = () => {throw e};
    }
    finally
    {
        assert.throws(f, msg);
    }
}

describe("PackageFactory", function () {
    let subject: packages.PackageFactory;
    let mockContext: mocks.Context;
    let mockWorkspaces: mocks.AutoprojWorkspaces;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockWrapper: mocks.VSCode;
    beforeEach(function () {
        mockContext = new mocks.Context;
        mockWorkspaces = new mocks.AutoprojWorkspaces;
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        mockWrapper = new mocks.VSCode;
        mockContext.vscode = mockWrapper.mock.object;
        mockContext.workspaces = mockWorkspaces.mock.object;
        subject = new packages.PackageFactory(mockTaskProvider.object);
    })
    it("creates a ConfigPackage", async function () {
        let path = '/path/to/package';
        mockWorkspaces.defineAsConfig(path, true);
        let aPackage = await subject.createPackage(path, mockContext.mock.object);
        await assertThrowsAsync(async () => {
            await aPackage.build();
        }, /configuration package/);
    })
    it("creates an InvalidPackage if package is not in vscode ws", async function () {
        let path = '/path/to/package';
        mockWorkspaces.defineAsConfig(path, false);
        mockWrapper.addResourceToFolder(path, undefined);
        let aPackage = await subject.createPackage(path, mockContext.mock.object);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    it("creates an InvalidPackage if path is null or undefined", async function () {
        let aPackage = await subject.createPackage(undefined, mockContext.mock.object);
        assert.equal(aPackage.name, '(Invalid package)');
    })
    describe("the package is neither invalid nor a configuration", function () {
        let aPackage: packages.Package;
        let path = '/path/to/package';
        beforeEach(function () {
            mockWorkspaces.defineAsConfig(path, false);
            mockWrapper.addCodeWorkspaceFolder(path);
        })
        it("creates a ForeignPackage if the package is not in an autoproj ws", async function () {
            aPackage = await subject.createPackage(path, mockContext.mock.object);
            await assertThrowsAsync(async () => {
                await aPackage.build();
            }, /not part of an autoproj workspace/);
        })
        describe("the package is in an autoproj workspace", function () {
            let mockWs: TypeMoq.IMock<autoproj.Workspace>;
            beforeEach(function () {
                mockWs = mockWorkspaces.addFolder(path, dirname(path))
            })
            it("returns the type set by the user", async function () {
                mockContext.setPackageType(path, "ruby");
                aPackage = await subject.createPackage(path, mockContext.mock.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.RUBY));
            })
            it("returns an OTHER package if the manifest could not be loaded", async function () {
                mockContext.setPackageType(path, undefined);
                mockWorkspaces.rejectInfoPromise(mockWs, "test")
                aPackage = await subject.createPackage(path, mockContext.mock.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.OTHER));
            })
            it("returns the package type defined in the manifest", async function () {
                mockContext.setPackageType(path, undefined);
                mockWorkspaces.resolveInfoPromise(mockWs, dirname(path));
                await mockWorkspaces.setPackageType("package", "Autobuild::CMake", mockWs);
                aPackage = await subject.createPackage(path, mockContext.mock.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.CXX));
            })
            it("returns OTHER if the package is not in the manifest", async function () {
                mockContext.setPackageType(path, undefined);
                mockWorkspaces.resolveInfoPromise(mockWs, dirname(path));
                aPackage = await subject.createPackage(path, mockContext.mock.object);
                assert.deepEqual(aPackage.type, packages.Type.fromType(packages.TypeList.OTHER));
            })
        })
    })
})

describe("InvalidPackage", function () {
    let subject;
    beforeEach(function () {
        subject = new packages.InvalidPackage();
    })
    it("returns a valid string as its name", function () {
        assert.equal(subject.name, "(Invalid package)");
    })
    it("does not allow to debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Select a valid package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Select a valid package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /Select a valid package/);
    })
    it("returns an invalid package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.invalid());
    })
})

describe("ConfigPackage", function () {
    let subject;
    beforeEach(function () {
        subject = new packages.ConfigPackage("/path/to/package");
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /configuration package/);
    })
    it("does not allow to pick a debugging target", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /configuration package/);
    })
    it("does not allow to pick the package type", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickType();
        }, /configuration package/);
    })
    it("returns the CONFIG package type", function () {
        assert.deepEqual(subject.type,
            packages.Type.config());
    })
})

async function testTargetPicker(subject: packages.Package,
    mockContext: mocks.Context)
{
    let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
    let target = new debug.Target('file', '/a/picked/file');
    const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        defaultUri: vscode.Uri.file(subject.path)
    };
    const uri = Promise.resolve([ vscode.Uri.file('/a/picked/file') ]);

    mockContext.vscode = mockWrapper.object;
    mockWrapper.setup(x => x.showOpenDialog(options)).returns(() => uri);
    mockContext.setDebuggingTarget(subject.path, target);
    await subject.pickTarget();
    mockContext.mock.verify(x => x.setDebuggingTarget(subject.path, target),
        TypeMoq.Times.once());
    assert.equal(subject.target.name, 'file');
    assert.equal(subject.target.path, '/a/picked/file');
}

async function testTypePicker(subject: packages.Package,
    mockContext: mocks.Context)
{
    let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
    let expectedChoices = new Array<{
        label: string,
        description: string,
        type: packages.Type
    }>();
    packages.TypeList.allTypes.forEach((type) => {
        expectedChoices.push({
            label: type.label,
            description: '',
            type: type
        });
    });
    let packageType = {
        label: 'Ruby',
        description: '',
        type: packages.TypeList.RUBY
    }
    mockContext.vscode = mockWrapper.object;
    mockWrapper.setup(x => x.showQuickPick(expectedChoices, TypeMoq.It.isAny())).
        returns(() => Promise.resolve(packageType));

    await subject.pickType();
    mockWrapper.verify(x => x.showQuickPick(expectedChoices, TypeMoq.It.isAny()), TypeMoq.Times.once());
    mockContext.mock.verify(x => x.setPackageType(subject.path, packages.TypeList.RUBY),
        TypeMoq.Times.once());
}

describe("ForeignPackage", function () {
    let subject;
    let mockContext: mocks.Context;
    beforeEach(function () {
        mockContext = new mocks.Context();
        subject = new packages.ForeignPackage("/path/to/package",
            mockContext.mock.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /not part of an autoproj workspace/);
    })
    it("does not allow building", async function () {
        await assertThrowsAsync(async () => {
            await subject.build();
        }, /not part of an autoproj workspace/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
})

describe("RockRubyPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: mocks.Context;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockContext = new mocks.Context;
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockRubyPackage("/path/to/package",
            mockContext.mock.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = new mocks.VSCode;

        mockContext.vscode = mockWrapper.mock.object;
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;
        await subject.build();
        mockWrapper.mock.verify(x => x.executeCommand("workbench.action.tasks.runTask", taskName),
            TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        await testTargetPicker(subject, mockContext);
    })
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("throws if environment cannot be loaded", async function () {
            let error = new Error("test");
            const target = new debug.Target('package', '/path/to/package/build/test');
            mockBridge.setup(x => x.env(subject.path)).returns(() => Promise.reject(error));
            mockContext.bridge = mockBridge.object;
            mockContext.setDebuggingTarget(subject.path, target);
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /test/);
        })
        it("starts a ruby debugging session", async function () {
            let mockWrapper = new mocks.VSCode;
            mockContext.vscode = mockWrapper.mock.object;
            mockContext.bridge = mockBridge.object;

            const target = new debug.Target('package', '/path/to/package/build/test');
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const type = packages.TypeList.RUBY;
            let env = {
                key: 'KEY',
                value: 'VALUE'
            }
            const options = {
                type: "Ruby",
                name: "rock debug",
                request: "launch",
                program: target.path,
                cwd: userConf.cwd,
                args: userConf.args,
                env: env
            };
            mockBridge.setup(x => x.env(subject.path)).returns(() => Promise.resolve(env));
            mockContext.setDebuggingConfigurationForPkg(subject.path, userConf);
            mockContext.setDebuggingTarget(subject.path, target);

            let folder = mockWrapper.addCodeWorkspaceFolder(subject.path);
            await subject.debug();
            mockWrapper.mock.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the RUBY package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.RUBY));
    })
})

describe("RockCXXPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: mocks.Context;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = new mocks.Context;
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockCXXPackage("/path/to/package",
            mockContext.mock.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = new mocks.VSCode;

        mockContext.vscode = mockWrapper.mock.object;
        mockTaskProvider.setup(x => x.buildTask(subject.path)).returns(() => task);

        let taskName = task.source + ": " + task.name;
        await subject.build();
        mockWrapper.mock.verify(x => x.executeCommand("workbench.action.tasks.runTask",
            taskName), TypeMoq.Times.once());
    })
    it("shows the target picking ui and sets the debugging target", async function () {
        await testTargetPicker(subject, mockContext);
    })
    describe("debug()", function () {
        it("throws if the debugging target is unset", async function () {
            await assertThrowsAsync(async () => {
                await subject.debug();
            }, /Select a debugging target/);
        })
        it("starts a cxx debugging session", async function () {
            let mockWrapper = new mocks.VSCode;
            mockContext.vscode = mockWrapper.mock.object;

            const target = new debug.Target('package', '/path/to/package/build/test');
            const type = packages.TypeList.CXX;
            let userConf: context.RockDebugConfig = {
                cwd: subject.path,
                args: ['--test'],
                orogen: {
                    start: true,
                    gui: true,
                    confDir: subject.path
                }
            }
            const options = {
                type: "cppdbg",
                name: "rock debug",
                request: "launch",
                program: target.path,
                externalConsole: false,
                MIMode: "gdb",
                cwd: userConf.cwd,
                args: userConf.args,
                setupCommands: [
                    {
                        description: "Enable pretty-printing for gdb",
                        text: "-enable-pretty-printing",
                        ignoreFailures: false
                    }
                ]
            };
            let folder = mockWrapper.addCodeWorkspaceFolder(subject.path);
            mockContext.setDebuggingConfigurationForPkg(subject.path, userConf);
            mockContext.setDebuggingTarget(subject.path, target);

            await subject.debug();
            mockWrapper.mock.verify(x => x.startDebugging(folder, options), TypeMoq.Times.once());
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the CXX package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.CXX));
    })
})

describe("RockOtherPackage", function () {
    let subject: packages.RockOtherPackage;
    let mockContext: mocks.Context;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    beforeEach(function () {
        mockContext = new mocks.Context;
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockOtherPackage("/path/to/package",
            mockContext.mock.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = new mocks.VSCode;

        mockContext.vscode = mockWrapper.mock.object;
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;

        await subject.build();
        mockWrapper.mock.verify(x => x.executeCommand("workbench.action.tasks.runTask",
            taskName), TypeMoq.Times.once());
    })
    it("does not allow debugging target picking", async function () {
        await assertThrowsAsync(async () => {
            await subject.pickTarget();
        }, /Set the package type/);
    })
    it("does not allow debugging", async function () {
        await assertThrowsAsync(async () => {
            await subject.debug();
        }, /Set the package type/);
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the OTHER package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OTHER));
    })
})
/*
describe("RockOrogenPackage", function () {
    let subject: packages.RockRubyPackage;
    let mockContext: mocks.Context;
    let mockTaskProvider: TypeMoq.IMock<tasks.Provider>;
    let mockBridge: TypeMoq.IMock<async.EnvironmentBridge>;
    beforeEach(function () {
        mockBridge = TypeMoq.Mock.ofType<async.EnvironmentBridge>();
        mockContext = new mocks.Context;
        mockTaskProvider = TypeMoq.Mock.ofType<tasks.Provider>();
        subject = new packages.RockOrogenPackage("/path/to/package",
            mockContext.mock.object, mockTaskProvider.object);
    })
    it("returns the basename", function () {
        assert.equal(subject.name, "package");
    })
    it("returns the task provided by the task provider", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");

        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let theTask = subject.buildTask;
        assert.deepEqual(theTask, task);
    })
    it("starts an autoproj build task", async function () {
        let defs: vscode.TaskDefinition = { type: "test" };
        let task = new vscode.Task(defs, "test", "test");
        let mockWrapper = new mocks.VSCode;

        mockContext.vscode = mockWrapper.mock.object;
        mockTaskProvider.setup(x => x.buildTask(subject.path)).
            returns(() => task);

        let taskName = task.source + ": " + task.name;
        await subject.build();
        mockWrapper.mock.verify(x => x.executeCommand("workbench.action.tasks.runTask",
            taskName), TypeMoq.Times.once());
    })
    describe("pickTarget()", function () {
        it("throws if orogen project loading fails", async function () {
            let error = new Error("test");
            let mockWrapper = new mocks.VSCode;
            mockContext.bridge = mockBridge.object;
            mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
            mockBridge.setup(x => x.describeOrogenProject(subject.path,
                subject.name)).returns(() => Promise.reject(error));
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
            await assertThrowsAsync(async () => {
                await subject.pickTarget();
            }, /test/);
        })
        it("shows the target picking ui and sets the debugging target", async function () {
            let mockWrapper = TypeMoq.Mock.ofType<wrappers.VSCode>();
            let expectedChoices = new Array<packages.IOrogenTaskPickerModel>();
            let task: async.IOrogenTask = {
                model_name: 'task1',
                deployment_name: "orogen_task1",
                file: '/some/bin/deployment/binfile'
            }

            expectedChoices.push({
                label: 'task1',
                description: '',
                task: task
            });

            let choices;
            mockBridge.setup(x => x.describeOrogenProject(subject.path, subject.name))
                .returns(() => Promise.resolve([ task ]));
            mockContext.setup(x => x.bridge).returns(() => mockBridge.object);
            mockContext.setup(x => x.vscode).returns(() => mockWrapper.object);
            mockWrapper.setup(x => x.showQuickPick(TypeMoq.It.is((x: packages.IOrogenTaskPickerModel[]) => {
                choices = x;
                return true;
            }), TypeMoq.It.isAny(), TypeMoq.It.isAny())).
                returns(() => Promise.resolve(expectedChoices[0]));

            await subject.pickTarget();
            let target = new debug.Target(task.model_name, task.file);
            mockContext.setup(x => x.getDebuggingTarget(subject.path)).
                returns(() => target)
            mockContext.verify(x => x.setDebuggingTarget(subject.path, target),
                TypeMoq.Times.once());
            assert.equal(subject.target.name, 'task1');
            assert.equal(subject.target.path, '/some/bin/deployment/binfile');
            return new Promise<void>((resolve, reject) => {
                choices.then(result => {
                    assert.deepEqual(result, expectedChoices);
                    resolve();
                });
            })
        })
    })
    it("shows the type picking ui and sets the package type", async function () {
        await testTypePicker(subject, mockContext);
    })
    it("returns the OROGEN package type", function () {
        assert.deepEqual(subject.type, packages.Type.fromType(packages.TypeList.OROGEN));
    })
})
*/