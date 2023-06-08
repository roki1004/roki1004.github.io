---
title : "Git Blog 사용법"
excerpt : "Git Blog"
image: jekyll-logo.png
tags:
    - Game Programmer
    - C#
    - Unity
---

---
1. git에서 레퍼지토리 만들기
    > https://present4n6.tistory.com/6?category=904222
2. git과 gitbash 설치하기
3. 레퍼지토리 주소 가져와서 gitbash로 원하는 폴더에 clone하기
4. jekyll -v, git --version, bundler --version, ruby -v, gem -v으로 버전 및 설치 되어있는지 확인하기.
5. 루비 설치하기.
    > https://present4n6.tistory.com/7?category=904222
6. jekyll bundler 설치하기.
    > jekyll bundler가 설치되어야 하는 ruby폴더의 경로에 빈칸띄어쓰기가 있는 폴더가 있으면 에러가 남.
7. 레퍼지토리가 설치되어있는 폴더로 가서 bundle init으로 Gemfile 생성하기.
    > https://jekyllrb.com/docs/step-by-step/10-deployment/
8. bundle add jekyll로 Gemfile에 jekyll 추가하기.
9. bundle exec jekyll serve로 로컬 서버 띄우기
    > Gemfile을 찾지 못하는 경우 7,8번을 사용해서 신규 Gemfile을 만들어줘야 함.
10. 주소창에 localhost:4000으로 접속해서 내 블로그 연결된거 확인하기.

---
기본적인 Git 사용법

https://wordbe.tistory.com/entry/Git-%EC%82%AC%EC%9A%A9-%EB%B0%A9%EB%B2%95-%EC%A0%95%EB%A6%ACcommit-push-pull-request-merge-%EB%93%B1

---
로컬 서버 띄우는 명령어

bundle exec jekyll serve
>> ctrl + c (종료)

---
