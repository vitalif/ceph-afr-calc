## Калькулятор вероятности потери данных в кластере Ceph/Vitastor

Установлен тут:

https://yourcmc.ru/afr-calc/

## А что такое Vitastor

Это мой быстрый цефозаменитель.

https://yourcmc.ru/git/vitalif/vitastor/

## Теоретическая модель

- Вероятность потери данных равна вероятности того, что в течение года выйдет из строя любой 1 диск
  и при этом в течение времени, которое восстанавливается недостающая копия данных, выйдут из строя
  все оставшиеся диски любой из PG, бывших на указанном диске...
- ...Либо из строя выйдет целый хост и в течение времени его восстановления выйдут из строя оставшиеся
  диски любой из PG, бывших на одном из его дисков.
- Вероятность выхода из строя одной PG = (вероятность выхода из строя диска = P) ^ (N-1),
  где N - фактор репликации. Либо вероятность выхода из строя любых K из N-1 дисков в случае EC.
- Это не на 100% верно, т.к. за время восстановления первого диска выйти из строя может не N-1
  дисков, а, например, только 1, и тогда к исходному времени восстановления добавляется в среднем
  ещё какое-то время (в среднем 1/2 исходного, но в любом случае <= исходного), в течение которого
  первый диск уже будет восстановлен, но второй ещё не будет, и данные снова будут потеряны, если
  из строя выйдет N-1 других дисков. И если за это время опять выйдет из строя какой-то диск,
  то время опять будет продлено, в среднем уже на 3/4 исходного, и так может быть до бесконечности.
  Однако пока считаем, что этими величинами можно пренебречь, т.к. они обычно меньше исходной
  вероятности минимум на порядок, т.к. исходная - условно P^N, а "повторная" начинается от P^(N+1).
  Подлянка может ожидать нас в случае EC с неразумным N и вероятностью отказа (N >= 1/P) - исходная
  C(n,k) * P^(k+1), а "повторная" - C(n,1) * C(n,k+1) * P^(k+2).
- Все PG, бывшие на указанном диске, для упрощения мы считаем не имеющими других общих OSD. Это,
  естественно, не совсем корректно, так как в Ceph они, наоборот, почти гарантированно пересекаются.
  Однако, теоретически, вероятность выхода из строя любой из непересекающихся PG всегда выше, чем
  если бы какие-то из них пересекались, то есть у нас будет оценка сверху.
- Степень пересечения мы попробуем учесть через парадокс дней рождений, см. ниже.
- В таком случае события выхода из строя разных PG независимы и вероятность выхода из строя любой
  из K PG, имевших в своём составе отказавший диск, равна единице минус вероятность того, что ни
  одна из K PG не выйдет из строя, то есть, (1 - (1 - P^(N-1)) ^ K).
- Итого (Умерло) = (1 - (не умерло ни из-за диска, ни из-за хоста)) =
  (1 - (1 - (умерло из-за диска))^(общее число дисков) * (1 - (умерло из-за хоста))^(число хостов)).
- (Умерло из-за диска) = (Умер диск) * (1 - (не умерла ни одна из его PG)) =
  (Умер диск) * (1 - (1 - умерла PG)^(число PG)).
- (Умер диск) = ((AFR диска) + (AFR сервера)/(число дисков)) * (Время восстановления в годах).
  AFR сервера эмпирически поделен на число дисков, чтобы "размазать" вероятность отказа сервера
  по его дискам.

### Парадокс дней рождений

- PG почти гарантированно пересекаются, особенно в небольших кластерах. Степень их пересечения
  очень полезно учитывать.
- Из задачи о парадоксе дней рождения мы знаем, что если в году N дней, а в группе K человек,
  то среднее число дней, являющихся хоть чьим-то днём рождения равно `U(N,K) = N*(1 - (1 - 1/N)^K)`.
  Это даёт нам возможность узнать, сколько в среднем уникальных элементов при K случайных выборах из N.
- На 1 диске в среднем размещается (число PG) групп чётности по (размер PG) дисков.
- 1 диск в среднем имеет примерно U((число хостов-1) * (число дисков), (число PG) * (размер PG - 1)) дисков,
  которые работают с ним в паре. Поделим это число на (размер PG - 1) и получим среднее число PG на диск с учётом пересечений.
- 1 хост в среднем имеет примерно U((число хостов-1) * (число дисков), (число дисков) * (число PG) * (размер PG - 1)) дисков,
  которые работают с ним в паре. Поделим это число на (размер PG - 1) и получим среднее число PG на сервер с учётом пересечений.
- При выходе из строя 1 диска и его мгновенной замене на другой все данные восстанавливаются на единственном
  новом заменном диске. В этом случае число дисков, участвующих в процессе восстановления - 1.
- При выходе из строя 1 диска без замены в Ceph по умолчанию его данные восстанавливаются на других дисках
  того же хоста. В этом случае число дисков, участвующих в процессе восстановления - U(число дисков-1, число PG).
- При выходе из строя 1 диска без замены в Vitastor или гипотетической иной системе его данные
  восстанавливаются на любых других дисках в кластере. В этом случае число дисков, участвующих в
  процессе восстановления - U((число хостов-1) * (число дисков), (число PG)).
- При выходе из строя целого хоста без возврата его дисков в строй в других хостах в восстановлении
  участвует U((число хостов-1) * (число дисков), (число дисков) * (число PG)) дисков.
- Зная число участвующих в восстановлении дисков, среднюю скорость восстановления в пересчёте на 1 диск,
  оцениваемую с учётом пропускной способности сети, а также объём дисков, мы можем рассчитать
  ожидаемое время восстановления данных одного диска или одного хоста.

## Симуляция (переборная модель)

К сожалению, при теоретическом расчёте по вышеприведённой модели корректно учесть степень
пересечения вероятностей выхода из строя разных PG всё равно не получается, из-за чего вероятность
оказывается завышенной.

Чтобы попробовать оценить вероятность более реально, придумана вторая модель - переборная.
Идея в том, чтобы сначала сгенерировать заданное количество случайных PG с учётом распределения
данных по хостам, а потом перебрать все варианты комбинаций событий их выхода из строя, по
принципу:
- PG 1 вышла из строя в течение года
- PG 1 не вышла из строя в течение года, но вышла из строя PG 2
- PG 1 и 2 не вышли из строя в течение года, но вышла из строя PG 3
- И так далее...

Как же подсчитать вероятности выхода из строя PG? Начнём с простого - N-кратной репликации:
- Берём очередную PG. Допустим, она включает диски 1, 2, ..., N.
- Поделим все варианты событий следующим образом:
  - Диск №1 умирает в течение года
    - Вероятность этого события равна AFR диска 1 = AFR1
    - Диск №2 умирает в диапазоне +- времени восстановления от диска №1 (либо до диска №1, либо после)
      - Вероятность этого события = AFR1 * AFR2 * 2 * время_восстановления / год
      - Диск №3 умирает в диапазоне +- времени восстановления от дисков №1 и №2
        - Вероятность этого события `AFR2 * коэффициент(2) * время_восстановления/год`
          - Коэффициент(N+1) - это среднее пересечение N+1-ого отрезка с предыдущими N,
            при условии, что центр каждого равномерно распределён в интервале от -1 до 1
            и длина равна 2.
          - Путём несложных умозаключений можно понять, что это 2 * (0.5 + объём_N-мерной_пирамиды/объём_N-мерного_куба)
          - Объём N-мерной пирамиды = 1/N * Площадь_основания * Высота = 1/N * 2^(N-1)
          - Так что коэффициент(N+1) равен просто (1 + 1/N)
        - И так далее для всех последующих дисков PG
      - Диск №4 не умирает в этом диапазоне => PG умереть уже не может (одна копия данных точно жива)
    - Диск №2 не умирает в этом диапазоне => PG умереть не может
  - Диск №1 не умирает в течение года => PG умереть не может
- После каждого шага мы знаем, что учли всю вероятность выхода из строя диска №1
- А также часть `(AFR1)` вероятности выхода из строка диска №2
- А также часть `(AFR1 * AFR2)` вероятности выхода из строка диска №3
- И так далее...
- Поэтому для последующих шагов вероятность выхода из строя диска №1 приравнивается к 0,
  а дисков №2 - №N умножается на `(1 - AFR1 * ... * AFRi-1)`

Эту же схему легко расширить до EC N+K - кстати, N реплик, по сути, то же самое, что "EC" 1+(N+1).
Нужно только в рамках каждой PG перебирать комбинации отказов дисков:
- Начать с `PREV=1` и `PGFAIL=0`
- Диск №1 умирает в течение года: `AFR1`
  - Число умерших дисков: `M=1`
  - Вероятность отказа текущей комбинации: `CUR=PREV*AFR1`
  - Для каждого последующего диска:
    - Диск №i умирает в диапазоне времени восстановления предыдущих: `X = Коэффициент(M+1)*Время*AFRi`
      - Если `M+1 > K`, добавить CUR к вероятности отказа PG и остановить ветку перебора
      - Иначе повторить перебор для остальных дисков с `M=M+1` и `CUR=CUR*X`
    - Диск №i не умирает в этом диапазоне
      - Уменьшить AFRi: `AFRi = AFRi * (1-CUR)`
      - Повторить перебор для остальных дисков с `M=M` и `CUR=CUR*(1-X)`
- Диск №1 не умирает в течение года: `1-AFR1`
  - Умножить `PREV = PREV*(1-AFR1)`
  - Приравнять оставшуюся (неучтённую) вероятность отказа диска 1 к 0: `AFR1 = 0`
  - Повторить перебор, начиная с последующих дисков, кроме последних K
- Общую вероятность отказа умножить на `(1-PGFAIL)`
- Перебрать таким же образом все последующие PG

## Про AFR сервера

В текущей версии калькулятора есть такой параметр, как AFR сервера. Означает он вероятность отказа
сразу целого сервера со всеми дисками, т.е. такого отказа, после которого на этих дисках не оказывается
данных и вернуть их в строй не представляется возможным.

На самом деле смысла в таком параметре довольно мало, так как такие ситуации крайне редки - сервер
скорее всего будет отремонтирован и возвращён в строй вместе с дисками, либо диски будут перемещены
в другие серверы.

Кроме того, в переборной модели он не работает вообще, а в теоретической работает нечестно :-).

Поэтому этот параметр, видимо, лучше удалить. Возможно, вместо него имело бы смысл рассмотреть другой
параметр "среднее время отключения сервера в течение года" и рассчитывать отказы, исходя из него, так
как пока любой из серверов выключен, часть данных доступна с ограниченным уровнем избыточности. Но
расчёт это, конечно, значительно усложнит.
