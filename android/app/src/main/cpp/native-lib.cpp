// Starts the embedded Node.js runtime (nodejs-mobile) and forwards its output to logcat.
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

static const char *TAG = "SequenceNode";
static int stdoutPipe[2];
static int stderrPipe[2];

static void *pump(void *arg) {
    int fd = *static_cast<int *>(arg);
    int priority = fd == stdoutPipe[0] ? ANDROID_LOG_INFO : ANDROID_LOG_ERROR;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof(buf) - 1)) > 0) {
        if (buf[n - 1] == '\n') n--;
        buf[n] = '\0';
        __android_log_write(priority, TAG, buf);
    }
    return nullptr;
}

static void redirectOutput() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    pipe(stdoutPipe);
    pipe(stderrPipe);
    dup2(stdoutPipe[1], STDOUT_FILENO);
    dup2(stderrPipe[1], STDERR_FILENO);
    pthread_t t1, t2;
    pthread_create(&t1, nullptr, pump, &stdoutPipe[0]);
    pthread_create(&t2, nullptr, pump, &stderrPipe[0]);
    pthread_detach(t1);
    pthread_detach(t2);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_sequence_tv_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray jargs) {
    jsize argc = env->GetArrayLength(jargs);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto js = static_cast<jstring>(env->GetObjectArrayElement(jargs, i));
        const char *s = env->GetStringUTFChars(js, nullptr);
        args.emplace_back(s);
        total += strlen(s) + 1;
        env->ReleaseStringUTFChars(js, s);
    }

    // Node expects argv strings to sit in one contiguous block of memory.
    char *block = static_cast<char *>(calloc(total, 1));
    char **argv = new char *[argc];
    char *p = block;
    for (jsize i = 0; i < argc; i++) {
        strcpy(p, args[i].c_str());
        argv[i] = p;
        p += args[i].size() + 1;
    }

    redirectOutput();
    return node::Start(argc, argv);
}
