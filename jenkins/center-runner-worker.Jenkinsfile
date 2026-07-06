pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'CENTER_RUNNER_ROOT', defaultValue: 'D:\\workspace\\center_Runner', description: 'Path to the Center Runner repo on the Jenkins agent.')
    string(name: 'TEST_REPO_ROOT', defaultValue: 'D:\\workspace\\TS_PW_FBC', description: 'Path to the TS_PW_FBC test repo on the Jenkins agent.')
    string(name: 'CENTER_RUNNER_URL', defaultValue: 'http://localhost:4317', description: 'Center Runner server URL.')
    string(name: 'WORKER_COUNT', defaultValue: '1', description: 'How many Center Runner workers to start in this build.')
    string(name: 'ENV_CREDENTIALS_ID', defaultValue: 'ALL_DOMAINS_ENV_FILE', description: 'Jenkins Secret file credential ID for TS_PW_FBC .env.')
  }

  environment {
    CENTER_RUNNER_ROOT = "${params.CENTER_RUNNER_ROOT}"
    TEST_REPO_ROOT = "${params.TEST_REPO_ROOT}"
    CENTER_RUNNER_URL = "${params.CENTER_RUNNER_URL}"
    CENTER_RUNNER_COMMAND_SOURCE = "${params.CENTER_RUNNER_URL}/api/jobs/next"
    CENTER_RUNNER_TEST_REPO = "${params.TEST_REPO_ROOT}"
    WORKER_COUNT = "${params.WORKER_COUNT}"
  }

  stages {
    stage('Prepare .env') {
      steps {
        withCredentials([file(credentialsId: "${params.ENV_CREDENTIALS_ID}", variable: 'ALL_DOMAINS_ENV_FILE')]) {
          dir("${params.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-secret-env.bat'
          }
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        dir("${params.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\install-deps.bat'
        }
      }
    }

    stage('Run Workers') {
      steps {
        dir("${params.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\start-workers.bat'
        }
      }
    }
  }
}
