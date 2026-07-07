pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  environment {
    CENTER_RUNNER_ROOT         = "${WORKSPACE}"
    TEST_REPO_ROOT             = "D:\\workspace\\TS_PW_FBC"
    
    WORKER_ENV_CREDENTIALS_ID  = "WORKER_ENV"
    TEST_ENV_CREDENTIALS_ID    = "" 
    
    // 💡 Mẹo cốt lõi: Đổi Cookie thành "dontKillMe" để Jenkins không tắt các tiến trình con sau khi kết thúc pipeline.
    JENKINS_SERVER_COOKIE      = "dontKillMe"
  }

  stages {
    stage('Prepare worker .env') {
      steps {
        withCredentials([file(credentialsId: "${env.WORKER_ENV_CREDENTIALS_ID}", variable: 'CENTER_ENV_FILE')]) {
          dir("${env.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-env.bat worker.env'
          }
        }
      }
    }

    stage('Prepare test repo .env') {
      when {
        expression { return env.TEST_ENV_CREDENTIALS_ID?.trim() }
      }
      steps {
        withCredentials([file(credentialsId: "${env.TEST_ENV_CREDENTIALS_ID}", variable: 'ALL_DOMAINS_ENV_FILE')]) {
          dir("${env.CENTER_RUNNER_ROOT}") {
            bat 'jenkins\\prepare-secret-env.bat'
          }
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        dir("${env.CENTER_RUNNER_ROOT}") {
          bat 'jenkins\\install-deps.bat'
        }
      }
    }

    stage('Run Workers') {
      steps {
        dir("${env.CENTER_RUNNER_ROOT}") {
          // 💡 Thay đổi tại đây: Sử dụng lệnh `start /B` để chạy ngầm script trong background 
          // mà không chặn (block) làm đứng pipeline của Jenkins, giúp Jenkins kết thúc thành công trong khi Worker vẫn chạy.
          bat 'start /B jenkins\\start-workers.bat'
        }
      }
    }
  }
}